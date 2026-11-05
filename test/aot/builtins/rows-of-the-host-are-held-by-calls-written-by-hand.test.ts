// differential.test.ts calls every row with operands out of one store. Some rows it does not call at all: they start a process, or a
// call spells out a number that the table does not know. Others answer something rare that no operand of the store brings out: an
// error for a path that is too long, the reason of a promise that is rejected later. What such a row says that native code makes would
// be held by nothing, and the compiler decides by it which classes have objects.
//
// Here each of them has calls written by hand. What native code answered, handed to a function of the program or settled a promise with
// is held against the type that the row says, by the judge of differential.test.ts. And every part of that type needs a value that no
// other part takes in, or a word on why no call brings one out: so a row that loses a part turns this test red.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { serialize } from "bun:jsc";
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { EventEmitter, getEventListeners } from "node:events";
import { closeSync, openSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { domainToASCII, domainToUnicode } from "node:url";
import { MIMEParams, MIMEType, parseEnv } from "node:util";
import { describe, test } from "../supported";
import { never } from "./differential/fixtures";
import { Log } from "./differential/log";
import { Realm } from "./differential/members";
import type { Run } from "./differential/runs";
import {
  Table,
  type CallMode,
  type DumpedOverload,
  type DumpedPlace,
  type DumpedType,
  type DumpedTypePart,
} from "./differential/table-description";
import { createTypeContext, findMismatch } from "./differential/types";
import { bindingOf } from "./native-contract/host-instances";

const dump = aotBuiltinEntries();
const realm = new Realm(new Table(dump));

// A value, and the operands of the call that brought it out where the type speaks of them.
type Seen = { value: unknown; args?: unknown[] };
type Case = {
  row: string;
  mode: CallMode;
  place: string;
  typesIn(overload: DumpedOverload): DumpedType[];
  see(): Seen[] | Promise<Seen[]>;
  // A part of the type, as describePart() spells it, and why no call brings it out.
  notBroughtOut?: Record<string, string>;
};

function mismatchOf(type: DumpedType, { value, args = [] }: Seen): string | undefined {
  const run = {
    log: new Log(),
    receiver: undefined,
    args,
    before: new Map(),
    after: new Map(),
    yielded: [],
  } as unknown as Run;
  return findMismatch(createTypeContext(realm, run), type, value);
}

const typeAt = (place: DumpedPlace | undefined): DumpedType[] => (place?.place === "NewValue" ? [place.type] : []);
const result = (overload: DumpedOverload) => [overload.result.type];
const settledWith = (slot: "PromiseValue" | "PromiseReason") => (overload: DumpedOverload) =>
  overload.result.type.parts.flatMap(part =>
    part.part === "Instance" && part.class === "Promise"
      ? part.contents.filter(held => held.slot === slot).map(held => held.type)
      : [],
  );
const handedToCallback = (position: number) => (overload: DumpedOverload) =>
  overload.callbacks.flatMap(callback => typeAt(callback.arguments[position]));
const callsOfHandler = (overload: DumpedOverload, handler: string) =>
  overload.handlerCalls.filter(({ callee }) => callee.place === "Member" && callee.path.join(".") === handler);
const handedToHandler = (handler: string, position: number | "this") => (overload: DumpedOverload) =>
  callsOfHandler(overload, handler).flatMap(call =>
    typeAt(position === "this" ? call.thisValue : call.arguments[position]),
  );

function describePart(part: DumpedTypePart): string {
  if (part.part === "Instance") return part.class;
  return part.part === "Builtin" ? `the built-in ${part.builtin}` : part.part;
}

// Each part with the type that is left without it. An instance of a class is one of every class above it, so a class below another
// of the same type takes in nothing of its own.
function partsOf(type: DumpedType): { name: string; rest: DumpedType }[] {
  const isBelowAnother = (part: DumpedTypePart) =>
    part.part === "Instance" &&
    type.parts.some(
      other => other !== part && other.part === "Instance" && realm.table.isSameOrSubclass(part.class, other.class),
    );
  return [
    ...type.primitives.map(name => ({
      name,
      rest: { ...type, primitives: type.primitives.filter(other => other !== name) },
    })),
    ...(type.hasAnyFunction ? [{ name: "any function", rest: { ...type, hasAnyFunction: false } }] : []),
    ...(type.hasPlainData ? [{ name: "plain data", rest: { ...type, hasPlainData: false } }] : []),
    ...type.parts.flatMap(part =>
      isBelowAnother(part)
        ? []
        : { name: describePart(part), rest: { ...type, parts: type.parts.filter(other => other !== part) } },
    ),
  ];
}

const quiet = ["true"];
const missing = "/a-file-that-is-not-there/for-this-test";
// Longer than any path of the system.
const longRoot = "\\\\" + "s".repeat(40000) + "\\share\\";
const fileSystem = () => bindingOf(realm, "native:Bindgen:node_fs_binding.bind.ts:binding");
const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => [],
    reason => [{ value: reason }],
  );
const later = <Handed extends unknown[]>(start: (callback: (...handed: Handed) => void) => unknown) =>
  new Promise<Handed>(resolve => void start((...handed) => resolve(handed)));

type Exit = { receiver: unknown; handed: unknown[] };
async function exitOf(command: string[], behind?: (child: Bun.Subprocess) => void): Promise<Exit> {
  const { promise, resolve } = Promise.withResolvers<Exit>();
  const child = Bun.spawn(command, {
    stdio: ["ignore", "ignore", "ignore"],
    onExit(...handed) {
      resolve({ receiver: this, handed });
    },
  });
  behind?.(child);
  return promise;
}
let exits: Promise<Exit[]> | undefined;
// One that ends by itself, one that a signal with a name ends, and one that a signal without a name ends, where there is such a signal.
const seeExits = () =>
  (exits ??= Promise.all([
    exitOf(quiet),
    exitOf(["sleep", "60"], child => child.kill("SIGTERM")),
    ...(isLinux ? [exitOf(["sh", "-c", "kill -40 $$"])] : []),
  ]));
const handedAtExit = (position: number | "this") => async () =>
  (await seeExits()).map(({ receiver, handed }) => ({ value: position === "this" ? receiver : handed[position] }));

type Channel = { message: Exit; end: Exit };
let channel: Promise<Channel> | undefined;
function seeChannel(): Promise<Channel> {
  return (channel ??= (async () => {
    const message = Promise.withResolvers<Exit>();
    const end = Promise.withResolvers<Exit>();
    const child = Bun.spawn([bunExe(), "-e", "process.send('sent'); process.disconnect();"], {
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      ipc(...handed) {
        message.resolve({ receiver: this, handed });
      },
      onDisconnect(...handed) {
        end.resolve({ receiver: this, handed });
      },
    });
    const seen = { message: await message.promise, end: await end.promise };
    await child.exited;
    return seen;
  })());
}

function withDescriptors<Answer>(use: (open: number, closed: number) => Answer): Answer {
  using folder = tempDir("aot-rows-by-hand", { file: "text" });
  const open = openSync(join(String(folder), "file"), "r");
  const closed = openSync(join(String(folder), "file"), "r");
  closeSync(closed);
  const answer = use(open, closed);
  Promise.resolve(answer).finally(() => closeSync(open));
  return answer;
}

function sitesHanded(): unknown[] {
  const before = Error.prepareStackTrace;
  let handed: unknown[] = [];
  Error.prepareStackTrace = function (this: unknown, ...operands) {
    handed = [this, ...operands];
    return "";
  };
  try {
    void new Error("made for this test").stack;
  } finally {
    Error.prepareStackTrace = before;
  }
  return handed;
}

function thrownBy(run: () => unknown): Seen[] {
  try {
    run();
    return [];
  } catch (error) {
    return [{ value: error }];
  }
}

const outOfMemory = "it takes a machine that is out of memory";
const collected = "it takes a collection of the object before the process ends";
const readsIntoBuffer = (method: "read" | "readv") => (descriptor: number) =>
  method === "read"
    ? fileSystem().read(descriptor, Buffer.alloc(4), 0, 4, 0)
    : fileSystem().readv(descriptor, [Buffer.alloc(4)], 0);

function listenedTo(): EventTarget {
  const target = new EventTarget();
  target.addEventListener("made-for-this-test", () => {});
  return target;
}

const cases: Case[] = [
  {
    row: "native:Bindgen:node_util_binding.bind.ts:parseEnv",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [{ value: parseEnv("FIRST=1\nSECOND=two\n7=seven") }, { value: parseEnv("") }],
  },
  {
    row: "native:NewCppFunction:JSEventTargetNode.cpp:jsFunctionNodeEventsGetEventListeners",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [
      { value: getEventListeners(listenedTo(), "made-for-this-test") },
      { value: getEventListeners(new EventTarget(), "nobody-listens") },
    ],
  },
  {
    row: "%MIMEBinding%.MIMEType",
    mode: "Construct",
    place: "the result",
    typesIn: result,
    see: () => [
      { value: new MIMEType("text/plain;charset=utf-8") },
      { value: new (class extends MIMEType {})("text/plain") },
    ],
  },
  {
    row: "%MIMEBinding%.MIMEParams",
    mode: "Construct",
    place: "the result",
    typesIn: result,
    see: () => [{ value: new MIMEParams() }, { value: new (class extends MIMEParams {})() }],
  },
  ...(["resolveWin32", "relativeWin32"] as const).map((name): Case => ({
    row: `native:Bindgen:node_path.bind.ts:${name}`,
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      name === "resolveWin32"
        ? [{ value: win32.resolve("C:\\a", "b") }, { value: win32.resolve(longRoot, "file") }]
        : [{ value: win32.relative("C:\\a", "C:\\b") }, { value: win32.relative(longRoot, longRoot + "file") }],
  })),
  {
    row: "native:Bindgen:node_path.bind.ts:toNamespacedPathWin32",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      [{}, "C:\\a", longRoot + "file"].map(operand => ({
        value: win32.toNamespacedPath(operand as string),
        args: [operand],
      })),
  },
  {
    row: "native:Bindgen:node_path.bind.ts:toNamespacedPathPosix",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [{}, "/a", 7].map(operand => ({ value: posix.toNamespacedPath(operand as string), args: [operand] })),
  },
  {
    row: "native:Cpp:NodeURL.cpp:Bun::createNodeURLBinding",
    mode: "Call",
    place: "the result of the functions that it holds",
    typesIn: result,
    see: () =>
      [domainToASCII("español.com"), domainToASCII("xn--iñvalid.com"), domainToUnicode("xn--espaol-zwa.com")].map(
        value => ({ value }),
      ),
  },
  {
    row: "%NodeJSFS%.prototype.stat",
    mode: "Call",
    place: "the reason of the promise",
    typesIn: settledWith("PromiseReason"),
    see: () => reasonOf(fileSystem().stat(missing)),
    notBroughtOut: { RangeError: outOfMemory },
  },
  {
    row: "%NodeJSFS%.prototype.statCb",
    mode: "Call",
    place: "the first operand of the callback",
    typesIn: handedToCallback(0),
    see: async () => [
      { value: (await later(callback => fileSystem().statCb(callback, missing)))[0] },
      { value: (await later(callback => fileSystem().statCb(callback, ".")))[0] },
    ],
  },
  ...(["read", "readv"] as const).flatMap((method): Case[] => [
    {
      row: `%NodeJSFS%.prototype.${method}`,
      mode: "Call",
      place: "the value of the promise",
      typesIn: settledWith("PromiseValue"),
      see: () => withDescriptors(async open => [{ value: await readsIntoBuffer(method)(open) }]),
    },
    {
      row: `%NodeJSFS%.prototype.${method}`,
      mode: "Call",
      place: "the reason of the promise",
      typesIn: settledWith("PromiseReason"),
      see: () => withDescriptors((open, closed) => reasonOf(readsIntoBuffer(method)(closed))),
    },
    {
      row: `%NodeJSFS%.prototype.${method}Cb`,
      mode: "Call",
      place: "the result",
      typesIn: result,
      see: () =>
        withDescriptors(async open => {
          let value: unknown = "nothing yet";
          await later(callback => {
            const operands = method === "read" ? [Buffer.alloc(4), 0, 4, 0] : [[Buffer.alloc(4)], 0];
            value = fileSystem()[`${method}Cb`](callback, open, ...operands);
          });
          return [{ value }];
        }),
    },
  ]),
  ...(["this", 0, 1, 2, 3] as const).map((position): Case => ({
    row: "Bun.spawn",
    mode: "Call",
    place: position === "this" ? "`this` of onExit" : `operand ${position} of onExit`,
    typesIn: handedToHandler("onExit", position),
    see: handedAtExit(position),
    notBroughtOut: {
      ...(position === "this" || position === 0 ? { Undefined: collected } : {}),
      ...(position === 2 && !isLinux ? { Number: "every signal of this system has a name" } : {}),
      ...(position === 3 ? { Error: "it takes a process that the system cannot wait for" } : {}),
    },
  })),
  {
    row: "Bun.spawn",
    mode: "Call",
    place: "`this` of ipc",
    typesIn: handedToHandler("ipc", "this"),
    see: async () => [{ value: (await seeChannel()).message.receiver }],
  },
  {
    row: "Bun.spawn",
    mode: "Call",
    place: "operand 1 of ipc",
    typesIn: handedToHandler("ipc", 1),
    see: async () => [{ value: (await seeChannel()).message.handed[1] }],
  },
  {
    row: "Bun.spawn",
    mode: "Call",
    place: "`this` of onDisconnect",
    typesIn: handedToHandler("onDisconnect", "this"),
    see: async () => [{ value: (await seeChannel()).end.receiver }],
  },
  {
    row: "Bun.spawn",
    mode: "Call",
    place: "operand 0 of onDisconnect",
    typesIn: handedToHandler("onDisconnect", 0),
    see: async () => [{ value: (await seeChannel()).end.handed[0] }],
  },
  {
    row: "Error.prepareStackTrace",
    mode: "Set",
    place: "`this` of the function that is stored",
    typesIn: overload => overload.callbacks.flatMap(callback => typeAt(callback.thisValue)),
    see: () => [{ value: sitesHanded()[0] }],
  },
  {
    row: "Error.prepareStackTrace",
    mode: "Set",
    place: "operand 1 of the function that is stored",
    typesIn: handedToCallback(1),
    see: () => [{ value: sitesHanded()[2] }],
  },
  {
    row: "Buffer.prototype.parent",
    mode: "Get",
    place: "the result",
    typesIn: result,
    see: () =>
      [Buffer.alloc(1), Buffer.from(new SharedArrayBuffer(4)), {}].map(receiver => ({
        value: Reflect.get(Buffer.prototype, "parent", receiver),
      })),
  },
  {
    row: "Buffer.prototype.offset",
    mode: "Get",
    place: "the result",
    typesIn: result,
    see: () => [Buffer.alloc(1), {}].map(receiver => ({ value: Reflect.get(Buffer.prototype, "offset", receiver) })),
  },
  ...(["alloc", "allocUnsafe", "allocUnsafeSlow"] as const).map((name): Case => ({
    row: `Buffer.${name}`,
    mode: "Construct",
    place: "the result",
    typesIn: result,
    see: () => [{ value: Reflect.construct(Buffer[name], [3]) }, { value: Reflect.construct(Buffer[name], [3], Map) }],
  })),
  {
    row: "native:Bindgen:node_fs_binding.bind.ts:binding",
    mode: "Get",
    place: "the result",
    typesIn: result,
    see: () => [{ value: fileSystem() }],
  },
  {
    row: "%PrivateGlobals%.makeErrorWithCode",
    mode: "Call",
    place: "the result",
    typesIn: result,
    // The library makes its errors with it: one that keeps nothing of what it is handed, and one of each row that does.
    see: () => [
      ...thrownBy(() => new EventEmitter().emit("error", 5)),
      ...thrownBy(() => Buffer.alloc(-1)),
      ...thrownBy(() => Buffer.from(5 as unknown as string)),
    ],
  },
];

// Code of an operand that native code runs, and the word of the row for it. The store of differential.test.ts has no such operand.
type CodeThatRuns = {
  row: string;
  operand: number;
  protocol: string;
  what: string;
  provoke(note: () => void): unknown;
};

function stringObject(note: () => void): String {
  const object = new String("as made");
  object.toString = () => (note(), "converted");
  return object;
}

async function withServerSocket(use: (socket: Bun.ServerWebSocket<unknown>) => void): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no upgrade")),
    websocket: {
      open(socket) {
        use(socket);
        resolve();
      },
      message() {},
    },
  });
  const client = new WebSocket(`ws://localhost:${server.port}`);
  await promise;
  client.close();
  await server.stop(true);
}

function errorWithMessage(note: () => void): Error {
  const error = new Error("made for this test");
  Reflect.set(error, "message", { toString: () => (note(), "converted") });
  return error;
}

const codeThatRuns: CodeThatRuns[] = [
  {
    row: "%ServerWebSocket%.prototype.sendText",
    operand: 0,
    protocol: "ToPrimitive",
    what: "toString() of a String object",
    provoke: note => withServerSocket(socket => void socket.sendText(stringObject(note) as string)),
  },
  {
    row: "%ServerWebSocket%.prototype.publishText",
    operand: 1,
    protocol: "ToPrimitive",
    what: "toString() of a String object",
    provoke: note => withServerSocket(socket => void socket.publishText("topic", stringObject(note) as string)),
  },
  {
    row: "structuredClone",
    operand: 0,
    protocol: "ToPrimitive",
    what: "toString() of what an error holds as its message",
    provoke: note => structuredClone(errorWithMessage(note)),
  },
  {
    row: "bun:jsc.serialize",
    operand: 0,
    protocol: "ToPrimitive",
    what: "toString() of what an error holds as its message",
    provoke: note => serialize(errorWithMessage(note)),
  },
  {
    row: "Bun.concatArrayBuffers",
    operand: 0,
    protocol: "PrototypeChain",
    what: "a getter below a list with a hole",
    provoke: note => {
      const list = [new Uint8Array(1), , new Uint8Array(1)];
      Object.setPrototypeOf(list, {
        __proto__: Array.prototype,
        get 1() {
          note();
          return new Uint8Array(1);
        },
      });
      return Bun.concatArrayBuffers(list as Uint8Array[]);
    },
  },
];

function overloadsOf({ row, mode }: Case): DumpedOverload[] {
  return dump.entries
    .filter(entry => entry.path === row)
    .flatMap(entry => entry.overloads.filter(overload => overload.mode === mode && !overload.isUndeclared));
}

function distinct(types: DumpedType[]): DumpedType[] {
  return [...new Map(types.map(type => [JSON.stringify(type), type])).values()];
}

function defineTests() {
  if (dump.entries.length === 0) return void test.skip("this build of Bun has no ahead-of-time compiler", () => {});

  describe.skipIf(isWindows)(
    "what native code hands out lies in the type that the row says, and every part of the type is brought out",
    () => {
      for (const held of cases) {
        test(`${held.row}: ${held.place}`, async () => {
          const types = distinct(overloadsOf(held).flatMap(held.typesIn));
          expect(types).not.toBeEmpty();
          const seen = await held.see();
          expect(seen).not.toBeEmpty();
          const problems: string[] = [];
          for (const one of seen) {
            const mismatches = types.map(type => mismatchOf(type, one));
            if (!mismatches.includes(undefined))
              problems.push(`native code hands out what the row does not say: ${mismatches[0]}`);
          }
          for (const type of types) {
            expect(type.isAnything || type.hasAnyObject).toBeFalse();
            for (const { name, rest } of partsOf(type)) {
              const isNeeded = seen.some(
                one => mismatchOf(type, one) === undefined && mismatchOf(rest, one) !== undefined,
              );
              const excuse = held.notBroughtOut?.[name];
              if (!isNeeded && excuse === undefined) problems.push(`no call brings out ${name}`);
              if (isNeeded && excuse !== undefined)
                problems.push(`${name} is brought out, and the test says: ${excuse}`);
            }
          }
          expect(problems).toEqual([]);
        });
      }

      // js_bun_spawn_bindings.rs makes no Subprocess for a script in spawnSync, and keeps none of the functions.
      test("Bun.spawnSync: it calls none of the handlers, and no row says that it does", () => {
        const handlers = ["onExit", "ipc", "onDisconnect", "terminal.data", "terminal.exit", "terminal.drain"];
        const rows = overloadsOf({ row: "Bun.spawnSync", mode: "Call" } as Case);
        expect(rows).not.toBeEmpty();
        expect(rows.flatMap(row => handlers.filter(handler => callsOfHandler(row, handler).length > 0))).toEqual([]);
        expect(
          overloadsOf({ row: "Bun.spawn", mode: "Call" } as Case).every(row =>
            handlers.every(handler => callsOfHandler(row, handler).length > 0),
          ),
        ).toBeTrue();
        const called: string[] = [];
        const note = (handler: string) => () => void called.push(handler);
        Bun.spawnSync(quiet, { onExit: note("onExit"), ipc: note("ipc"), onDisconnect: note("onDisconnect") } as any);
        expect(called).toEqual([]);
      });
    },
  );

  describe.skipIf(isWindows)(
    "where native code runs code of an operand, the row that takes any operand says so",
    () => {
      for (const { row, operand, protocol, what, provoke } of codeThatRuns) {
        test(`${row}: ${what}`, async () => {
          let hasRun = false;
          await provoke(() => void (hasRun = true));
          expect(hasRun).toBeTrue();
          const general = overloadsOf({ row, mode: "Call" } as Case).at(-1)!;
          const parameter = general.parameters.find(
            ({ operand: named }) => typeof named === "object" && "argument" in named && named.argument === operand,
          )!;
          expect(parameter.protocols).toContain(protocol);
        });
      }
    },
  );

  // node_fs.rs FsCompletion::reject() | resolve(). A parameter behind the operands of a call is undefined, which the type of the result does not say.
  test.skipIf(isWindows)(
    "%NodeJSFS%.prototype.statCb: the callback is handed the error alone, or null and the result, and the row lists both calls",
    async () => {
      const handedFor = async (path: string) => (await later(callback => fileSystem().statCb(callback, path))).length;
      expect([await handedFor(missing), await handedFor(".")]).toEqual([1, 2]);
      const rows = overloadsOf({ row: "%NodeJSFS%.prototype.statCb", mode: "Call" } as Case);
      expect(rows).not.toBeEmpty();
      for (const row of rows) expect(row.callbacks.map(callback => callback.arguments.length).sort()).toEqual([1, 2]);
    },
  );

  test("native:Bindgen:node_fs_binding.bind.ts:binding: it is no function, and its row for a call answers nothing", () => {
    expect(typeof fileSystem()).toBe("object");
    const rows = overloadsOf({ row: "native:Bindgen:node_fs_binding.bind.ts:binding", mode: "Call" } as Case);
    expect(rows).not.toBeEmpty();
    expect(rows.map(row => row.result.type)).toEqual(rows.map(() => never));
  });

  test("native:Cpp:JSMIMEParams.cpp:createJSMIMEBinding: it is no function, its two classes throw without `new`, and their rows for a call answer nothing", () => {
    const binding = bindingOf(realm, "native:Cpp:JSMIMEParams.cpp:createJSMIMEBinding");
    expect(typeof binding).toBe("object");
    expect(Reflect.ownKeys(binding).sort()).toEqual(["MIMEParams", "MIMEType"]);
    expect([binding.MIMEParams, binding.MIMEType]).toEqual([MIMEParams, MIMEType]);
    for (const made of [MIMEParams, MIMEType])
      expect(() => Reflect.apply(made, undefined, ["text/plain"])).toThrow(TypeError);
    for (const row of [
      "native:Cpp:JSMIMEParams.cpp:createJSMIMEBinding",
      "%MIMEBinding%.MIMEParams",
      "%MIMEBinding%.MIMEType",
    ]) {
      const all = dump.entries.filter(entry => entry.path === row).flatMap(entry => entry.overloads);
      expect(all.filter(overload => overload.isUndeclared)).toEqual([]);
      const calls = all.filter(overload => overload.mode === "Call");
      expect(calls).not.toBeEmpty();
      expect(calls.map(overload => overload.result.type)).toEqual(calls.map(() => never));
    }
  });

  // The compiler takes a read of a standard stream to hand out what a function of the library answered: native code makes no object there.
  test.each([
    ["a pipe", "pipe"],
    ["a file", "file"],
  ])(
    "process.stdin | stdout | stderr: over %s each is an object of a class that is written in JavaScript",
    async (_name, kind) => {
      using dir = tempDir("aot-rows-by-hand-streams", { "in.txt": "" });
      const program = `const said = ["stdin", "stdout", "stderr"].map(name => {
      const made = Object.getPrototypeOf(process[name]).constructor;
      return name + " " + typeof made + " " + !Function.prototype.toString.call(made).includes("[native code]");
    });
    require("node:fs").writeFileSync(process.argv[1], said.join());`;
      const at = (name: string) => (kind === "pipe" ? "pipe" : Bun.file(join(String(dir), name)));
      await using child = Bun.spawn([bunExe(), "-e", program, join(String(dir), "said.txt")], {
        env: bunEnv,
        stdin: kind === "pipe" ? "pipe" : Bun.file(join(String(dir), "in.txt")),
        stdout: at("out.txt"),
        stderr: at("err.txt"),
      });
      expect(await child.exited).toBe(0);
      expect(await Bun.file(join(String(dir), "said.txt")).text()).toBe(
        "stdin function true,stdout function true,stderr function true",
      );
    },
  );

  // The compiler takes what lies there from the start for an object all of whose members the table lists: no name but those of any function.
  test("Error.prepareStackTrace: until a program stores there, a read answers the function of native code that the row names", () => {
    const held = Error.prepareStackTrace as unknown as (error: Error, sites: unknown[]) => unknown;
    expect(typeof held).toBe("function");
    expect(Reflect.ownKeys(held).map(String).sort()).toEqual(["length", "name"]);
    expect(Reflect.getPrototypeOf(held)).toBe(Function.prototype);
    expect(held(new Error("made for this test"), [])).toBeString();
    const [read] = overloadsOf({ row: "Error.prepareStackTrace", mode: "Get" } as Case);
    expect(read.result.type).toEqual({ ...never, parts: [expect.objectContaining({ part: "Builtin" })] });
    const [named] = read.result.type.parts;
    const described = dump.entries.find(entry => named.part === "Builtin" && entry.token === named.builtin)!;
    expect(described).toMatchObject({ kind: "Function", flags: expect.arrayContaining(["ListsAllMembers"]) });
    expect(described.overloads.filter(row => row.mode === "Call").map(row => row.result.type)).toEqual([
      { ...never, primitives: ["String"] },
    ]);
  });

  // The judge refuses: a type without any part takes in nothing.
  test("a type that says nothing takes in no value", () => {
    for (const value of [undefined, null, 0, "", {}, () => {}, new Error("made for this test")])
      expect(mismatchOf(never, { value })).toBeString();
  });
}

defineTests();
