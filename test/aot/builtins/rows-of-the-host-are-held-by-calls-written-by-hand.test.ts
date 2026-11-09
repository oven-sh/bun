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
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tls } from "harness";
import { EventEmitter, getEventListeners } from "node:events";
import { closeSync, constants, openSync } from "node:fs";
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

async function certificateHandedOver(): Promise<unknown> {
  using server = Bun.serve({ port: 0, tls, fetch: () => new Response("served") });
  const { promise, resolve } = Promise.withResolvers<unknown>();
  const response = await fetch(`https://localhost:${server.port}/`, {
    keepalive: false,
    tls: { ca: tls.cert, checkServerIdentity: (_host: string, certificate: unknown) => void resolve(certificate) },
  });
  await response.text();
  return promise;
}

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

// The second descriptor is one that a read fails on. It is open, for writing only, and not closed: the number of a closed descriptor goes
// to the next file that is opened, and with a sanitizer the cases run beside one another (../supported.ts), so such a read can succeed.
function withDescriptors<Answer>(use: (open: number, writeOnly: number) => Answer): Answer {
  using folder = tempDir("aot-rows-by-hand", { file: "text" });
  const open = openSync(join(String(folder), "file"), "r");
  const writeOnly = openSync(join(String(folder), "file"), constants.O_WRONLY);
  const answer = use(open, writeOnly);
  Promise.resolve(answer).finally(() => {
    closeSync(open);
    closeSync(writeOnly);
  });
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

type NativeFunction = (...operands: unknown[]) => any;
// bun:ffi takes callback, cfunction and closeCallback away when it is loaded, and nothing loads it in front of this line.
const ffi: Record<string, NativeFunction> = { ...Reflect.get(Bun, "FFI") };
const wrapperOfFFI = (name: string): NativeFunction => bindingOf(realm, `native:Bindgen:ffi.bind.ts:${name}`);
const namesOfLibc =
  process.platform === "darwin"
    ? ["libSystem.B.dylib"]
    : ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`, "libc.so.7", "libc.so"];
const neverCalled = { ptr: 8, args: [], returns: "void" };
// A library holds native memory until it is closed. What is asked of it here is asked of a closed one as well.
const linkAndClose = () => {
  const linked = ffi.linkSymbols({ neverCalled });
  const { symbols } = linked;
  linked.close();
  return { linked, symbols };
};
const absolute = { abs: { args: ["i32"], returns: "i32" } };
const spreadToCallback = (overload: DumpedOverload) =>
  overload.callbacks.flatMap(callback => typeAt(callback.spreadArguments));

function openLibc(open: NativeFunction): { symbols: Record<string, NativeFunction>; close(): void } {
  for (const name of namesOfLibc) {
    try {
      const opened = open(name, absolute);
      if (!Error.isError(opened)) return opened;
    } catch {}
  }
  throw new Error("no name of the C library opens");
}

function closed(made: object): object {
  ffi.closeCallback(made);
  return made;
}

// The prototype of callbacks has no path from the global object. With it the judge tells a callback from any other object.
function prototypeOfCallbacks(): object {
  const prototype = Reflect.getPrototypeOf(closed(ffi.callback({}, () => {})))!;
  realm.register("%FFICallback%.prototype", prototype);
  return prototype;
}

// A function of native code that enters the callback hands it one operand of each kind.
function handedByNativeCode(makeCallback: NativeFunction, makeFunction: NativeFunction): Seen[] {
  const signature = { args: ["i32", "i64", "bool", "cstring", "ptr"], returns: "void" };
  let handed: unknown[] = [];
  const made = makeCallback(signature, (...operands: unknown[]) => void (handed = operands));
  makeFunction({ ...signature, ptr: made.ptr }, "entersTheCallback")(1, 2n, true, Buffer.from("text\0"), null);
  closed(made);
  return handed.map(value => ({ value }));
}

// What generate_symbols() and generate_symbol_for_function() run of their operand: the protocol, what it is, and the operand.
const symbolsWithCode: [string, string, (note: () => void) => object][] = [
  [
    "PrototypeChain",
    "a getter below a list of types with a hole",
    note => {
      const args = ["i32", , "i32"];
      Object.setPrototypeOf(args, {
        __proto__: Array.prototype,
        get 1() {
          note();
          return "i32";
        },
      });
      return { made: { args, returns: "void" } };
    },
  ],
  [
    "PrototypeChain",
    "an accessor that a signature inherits",
    note => ({
      made: {
        __proto__: {
          get returns() {
            note();
            return "void";
          },
        },
        args: [],
      },
    }),
  ],
  [
    "ToPrimitive",
    "toString() of a String object among the types",
    note => {
      const type = new String("i32");
      type.toString = () => (note(), "i32");
      return { made: { args: [type], returns: "void" } };
    },
  ],
  [
    "ToPrimitive",
    "toString() of what lies under `returns`",
    note => ({ made: { args: [], returns: { toString: () => (note(), "void") } } }),
  ],
  [
    "OwnValues",
    "a getter under the name of a symbol",
    note => ({
      get made() {
        note();
        return { args: [], returns: "void" };
      },
    }),
  ],
  [
    "OwnKeys",
    "the trap of a proxy that lists the names",
    note =>
      new Proxy({ made: { args: [], returns: "void" } }, { ownKeys: target => (note(), Reflect.ownKeys(target)) }),
  ],
];

// builtins/Glob.ts over glob.rs scan() | scan_sync(). No file has the ending, so nothing is yielded.
const scansOfGlob = (["scan", "scanSync"] as const).map(
  name =>
    [
      `Bun.Glob.prototype.${name}`,
      (options?: unknown) => new Bun.Glob("*.nothing-has-this-ending")[name](options as string),
    ] as const,
);
const casesOfGlob = scansOfGlob.map(([row, scan]): Case => ({
  row,
  mode: "Call",
  place: "the result",
  typesIn: result,
  see: () => [scan(), scan("."), scan(new String(".")), scan({ cwd: ".", dot: true })].map(value => ({ value })),
}));

// JSDOMFormData.cpp, blob.cpp toJS(). A File that was appended under no other name comes back as the object that it is, a Blob as a File that the form makes.
const valuesOfForm = () => ["text", new Blob(["bytes"]), new File(["bytes"], "file.txt")];
const formOf = (...values: (string | Blob)[]) => {
  const form = new FormData();
  for (const value of values) form.append("name", value);
  return form;
};
const iterationsOfForm = ["entries", "keys", "values"] as const;
const handedByForEachOfForm = (position: number) => () => {
  const seen: Seen[] = [];
  formOf(...valuesOfForm()).forEach((...operands: unknown[]) => void seen.push({ value: operands[position] }));
  return seen;
};
const casesOfFormData: Case[] = [
  {
    row: "FormData.prototype.get",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [formOf(), ...valuesOfForm().map(value => formOf(value))].map(form => ({ value: form.get("name") })),
  },
  {
    row: "FormData.prototype.getAll",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [formOf(), formOf(...valuesOfForm())].map(form => ({ value: form.getAll("name") })),
  },
  {
    row: "FormData.prototype.toJSON",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      [formOf(), formOf("text"), formOf(...valuesOfForm())].map(form => ({
        value: Reflect.get(form, "toJSON").call(form),
      })),
  },
  ...iterationsOfForm.map((name): Case => ({
    row: `FormData.prototype.${name}`,
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [{ value: formOf("text")[name]() }],
  })),
  {
    row: "%FormDataIterator%.prototype.next",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      iterationsOfForm.flatMap(name => {
        const iterator = formOf(...valuesOfForm())[name]();
        return Array.from({ length: 4 }, () => ({ value: iterator.next() }));
      }),
  },
  ...[0, 1].map((position): Case => ({
    row: "FormData.prototype.forEach",
    mode: "Call",
    place: `operand ${position} of the callback`,
    typesIn: handedToCallback(position),
    see: handedByForEachOfForm(position),
  })),
];

// JSCookieMap.cpp, JSBunRequest.cpp. The map hands out strings alone.
const cookies = () => new Bun.CookieMap("first=1; second=two");
const resultOfCookies = (name: string, see: Case["see"]): Case => ({
  row: `Bun.CookieMap.prototype.${name}`,
  mode: "Call",
  place: "the result",
  typesIn: result,
  see,
});
const routedRequest = async (route = "/:name", asked = "/a") => {
  const { promise, resolve } = Promise.withResolvers<Request>();
  const server = Bun.serve({ port: 0, routes: { [route]: request => (resolve(request), new Response("x")) } });
  await fetch(new URL(asked, server.url), { headers: { cookie: "first=1" } });
  const request = await promise;
  await server.stop(true);
  return request;
};
const casesOfCookies: Case[] = [
  resultOfCookies("get", () => [{ value: cookies().get("first") }, { value: cookies().get("none") }]),
  resultOfCookies("toJSON", () => [{ value: cookies().toJSON() }, { value: new Bun.CookieMap().toJSON() }]),
  resultOfCookies("toSetCookieHeaders", () => {
    const changed = cookies();
    changed.set("third", "3");
    changed.delete("first");
    return [{ value: changed.toSetCookieHeaders() }, { value: cookies().toSetCookieHeaders() }];
  }),
  ...iterationsOfForm.map(name => resultOfCookies(name, () => [{ value: cookies()[name]() }])),
  {
    row: "%CookieMapIterator%.prototype.next",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      iterationsOfForm.flatMap(name => {
        const iterator = cookies()[name]();
        return Array.from({ length: 3 }, () => ({ value: iterator.next() }));
      }),
  },
  ...[0, 1].map((position): Case => ({
    row: "Bun.CookieMap.prototype.forEach",
    mode: "Call",
    place: `operand ${position} of the callback`,
    typesIn: handedToCallback(position),
    see: () => {
      const seen: Seen[] = [];
      cookies().forEach((...operands: unknown[]) => void seen.push({ value: operands[position] }));
      return seen;
    },
  })),
  {
    row: "%BunRequest%.prototype.cookies",
    mode: "Get",
    place: "the result",
    typesIn: result,
    see: async () => {
      const request = await routedRequest();
      return [
        { value: Reflect.get(request, "cookies") },
        { value: Reflect.get(Reflect.getPrototypeOf(request)!, "cookies", {}) },
      ];
    },
  },
];

const casesOfFFI: Case[] = [
  ...(
    [
      ["Bun.FFI.callback", ffi.callback, ffi.cfunction],
      [
        "native:Bindgen:ffi.bind.ts:makeCallback",
        (...operands) => wrapperOfFFI("makeCallback")(...operands),
        (...operands) => wrapperOfFFI("makeFunction")(...operands),
      ],
    ] as [string, NativeFunction, NativeFunction][]
  ).map(([row, makeCallback, makeFunction]): Case => ({
    row,
    mode: "Call",
    place: "the operands of the function that native code calls",
    typesIn: spreadToCallback,
    see: () => handedByNativeCode(makeCallback, makeFunction),
  })),
  {
    row: "Bun.FFI.callback",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => (
      prototypeOfCallbacks(),
      [
        closed(ffi.callback({ args: ["i32"], returns: "i32" }, () => 1)),
        ffi.callback(5, () => {}),
        ffi.callback({ args: 5 }, () => {}),
      ].map(value => ({ value }))
    ),
  },
  {
    row: "native:Bindgen:ffi.bind.ts:makeCallback",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => (
      prototypeOfCallbacks(),
      [{ value: closed(wrapperOfFFI("makeCallback")({ args: ["i32"], returns: "i32", threadsafe: true }, () => 1)) }]
    ),
  },
  {
    row: "%FFICallback%.prototype.close",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [
      {
        value: Reflect.apply(
          Reflect.get(prototypeOfCallbacks(), "close"),
          ffi.callback({}, () => {}),
          [],
        ),
      },
    ],
  },
  {
    row: "Bun.FFI.closeCallback",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      [ffi.closeCallback(ffi.callback({}, () => {})), ffi.closeCallback(5), ffi.closeCallback()].map(value => ({
        value,
      })),
  },
  {
    row: "Bun.FFI.cfunction",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      [
        ffi.cfunction(neverCalled, "neverCalled"),
        ffi.cfunction(neverCalled),
        ffi.cfunction(5),
        ffi.cfunction({ args: 5 }),
      ].map(value => ({ value })),
  },
  {
    row: "native:Bindgen:ffi.bind.ts:makeFunction",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => [{ value: wrapperOfFFI("makeFunction")(neverCalled, "neverCalled") }],
  },
  {
    row: "Bun.FFI.dlopen",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => {
      const opened = openLibc(ffi.dlopen);
      opened.close();
      return [
        opened,
        ffi.dlopen(missing, absolute),
        ffi.dlopen(namesOfLibc[0], 5),
        ffi.dlopen(namesOfLibc[0], { abs: { args: 5 } }),
      ].map(value => ({ value }));
    },
  },
  {
    row: "Bun.FFI.linkSymbols",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () => {
      const refused = [ffi.linkSymbols({}), ffi.linkSymbols({ neverCalled: { args: 5 } })];
      return [linkAndClose().linked, ...refused].map(value => ({ value }));
    },
  },
  {
    row: "Bun.FFI.viewSource",
    mode: "Call",
    place: "the result",
    typesIn: result,
    see: () =>
      [
        ffi.viewSource(absolute, false),
        ffi.viewSource(absolute.abs, true),
        ffi.viewSource(5),
        ffi.viewSource({ abs: { args: 5 } }),
      ].map(value => ({ value })),
  },
  ...(["Call", "Construct"] as const).map((mode): Case => ({
    row: "Bun.FFI.CString",
    mode,
    place: "the result",
    typesIn: result,
    see: () => {
      const text = Buffer.from("text\0");
      const make = (...operands: unknown[]) =>
        mode === "Call" ? ffi.CString(...operands) : Reflect.construct(ffi.CString, operands);
      return [make(ffi.ptr(text)), make(ffi.ptr(text), 1, 2), make(0), make()].map(value => ({ value }));
    },
  })),
  {
    row: "%FFI%.prototype.symbols",
    mode: "Get",
    place: "the result",
    typesIn: result,
    see: () => {
      const opened = openLibc(ffi.dlopen);
      const { symbols } = opened;
      opened.close();
      return [symbols, opened.symbols, linkAndClose().symbols].map(value => ({ value }));
    },
    notBroughtOut: { Undefined: "native code hands out no library before it has laid the object there" },
  },
];

const cases: Case[] = [
  ...casesOfCookies,
  ...casesOfFFI,
  ...casesOfFormData,
  ...casesOfGlob,
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
      see: () => withDescriptors((open, writeOnly) => reasonOf(readsIntoBuffer(method)(writeOnly))),
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
    row: "fetch",
    mode: "Call",
    place: "operand 1 of tls.checkServerIdentity",
    typesIn: handedToHandler("tls.checkServerIdentity", 1),
    see: async () => [{ value: await certificateHandedOver() }],
    notBroughtOut: {
      Array:
        "the certificate of the harness has no uses of its key, no access to information and no part of a name twice, and only those are lists",
    },
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
  ...scansOfGlob.flatMap(([row, scan]) =>
    (
      [
        [
          "Named",
          "an accessor of the options",
          note => ({
            get cwd() {
              note();
              return ".";
            },
          }),
        ],
        [
          "Named",
          "an accessor that the options inherit",
          note => ({
            __proto__: {
              get dot() {
                note();
                return false;
              },
            },
          }),
        ],
        [
          "ToPrimitive",
          "toString() of a String object under `cwd`",
          note => {
            const cwd = new String(".");
            cwd.toString = () => (note(), ".");
            return { cwd };
          },
        ],
      ] as [string, string, (note: () => void) => object][]
    ).map(([protocol, what, options]): CodeThatRuns => ({
      row,
      operand: 0,
      protocol,
      what,
      provoke: note => scan(options(note)),
    })),
  ),
  ...(
    [
      ["Bun.FFI.viewSource", (...operands) => ffi.viewSource(...operands)],
      ["native:Bindgen:ffi.bind.ts:printSource", (...operands) => wrapperOfFFI("printSource")(...operands)],
    ] as [string, NativeFunction][]
  ).flatMap(([row, printSource]) =>
    symbolsWithCode.map(([protocol, what, symbols]): CodeThatRuns => ({
      row,
      operand: 0,
      protocol,
      what,
      provoke: note => printSource(symbols(note), false),
    })),
  ),
  ...(
    [
      ["Bun.FFI.cfunction", 1, name => ffi.cfunction(neverCalled, name)],
      ["native:Bindgen:ffi.bind.ts:makeFunction", 1, name => wrapperOfFFI("makeFunction")(neverCalled, name)],
      ["Bun.FFI.dlopen", 0, name => ffi.dlopen(name, { neverCalled })],
    ] as [string, number, NativeFunction][]
  ).map(([row, operand, named]): CodeThatRuns => ({
    row,
    operand,
    protocol: "ToPrimitive",
    what: "toString() of a String object that is the name",
    provoke: note => named(stringObject(note)),
  })),
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
            expect((type.isAnything && !type.isMadeOfListedClasses) || type.hasAnyObject).toBeFalse();
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

  // The compiler takes a read of `data` to hand back what the program handed in: native code makes no object there and gives no symbol.
  test("the data of a listener, a socket and a websocket of a server: a read answers what the options held or what was stored last, and undefined before that and once a listener has stopped", async () => {
    for (const row of ["Listener", "TCPSocket", "TLSSocket", "ServerWebSocket"].map(
      name => `%${name}%.prototype.data`,
    )) {
      const reads = overloadsOf({ row, mode: "Get" } as Case);
      expect(reads).not.toBeEmpty();
      const answers = reads.flatMap(read =>
        read.transfers.filter(({ to }) => to.place === "Result").map(({ from }) => from),
      );
      expect(answers).not.toBeEmpty();
      expect(answers).toEqual(
        answers.map(() => expect.objectContaining({ place: "NativeCell", holdsOnlyWhatIsStored: true })),
      );
    }
    const ofListener = { tag: "of the listener" };
    const ofClient = { tag: "of the client" };
    const storedLater = { tag: "stored later" };
    const accepted = Promise.withResolvers<Bun.Socket<unknown>>();
    const handlers = { data() {}, close() {}, error() {} };
    const acceptedBare = Promise.withResolvers<Bun.Socket<unknown>>();
    const bare = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { ...handlers, open: acceptedBare.resolve } });
    expect(bare.data).toBeUndefined();
    const bareClient = await Bun.connect({ hostname: "127.0.0.1", port: bare.port, socket: handlers });
    expect(bareClient.data).toBeUndefined();
    expect((await acceptedBare.promise).data).toBeUndefined();
    bareClient.end();
    bare.stop(true);
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      data: ofListener,
      socket: { ...handlers, open: accepted.resolve },
    });
    expect(listener.data).toBe(ofListener);
    const client = await Bun.connect({ hostname: "127.0.0.1", port: listener.port, data: ofClient, socket: handlers });
    expect(client.data).toBe(ofClient);
    expect((await accepted.promise).data).toBe(ofListener);
    client.data = storedLater;
    listener.data = storedLater;
    expect([client.data, listener.data]).toEqual([storedLater, storedLater]);
    expect(client.data).toBe(storedLater);
    expect(listener.data).toBe(storedLater);
    client.end();
    listener.stop(true);
    expect(listener.data).toBeUndefined();

    const ofSecureClient = { tag: "of the client that speaks TLS" };
    const ofSecureHalf = { tag: "of the half that speaks TLS" };
    const secure = Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: handlers });
    const secureClient = await Bun.connect({
      hostname: "127.0.0.1",
      port: secure.port,
      tls: { rejectUnauthorized: false },
      data: ofSecureClient,
      socket: handlers,
    });
    expect(secureClient.data).toBe(ofSecureClient);
    secureClient.data = storedLater;
    expect(secureClient.data).toBe(storedLater);
    secureClient.end();
    const plainClient = await Bun.connect({
      hostname: "127.0.0.1",
      port: secure.port,
      data: ofClient,
      socket: handlers,
    });
    const [rawHalf, secureHalf] = plainClient.upgradeTLS({
      data: ofSecureHalf,
      tls: { rejectUnauthorized: false },
      socket: handlers,
    });
    expect(rawHalf.data).toBe(ofClient);
    expect(secureHalf.data).toBe(ofSecureHalf);
    secureHalf.end();
    secure.stop(true);

    const ofUpgrade = { tag: "of the upgrade" };
    const opened = Promise.withResolvers<unknown[]>();
    const openedBare = Promise.withResolvers<unknown[]>();
    using server = Bun.serve({
      port: 0,
      fetch: (request, self) =>
        self.upgrade(request, new URL(request.url).search ? { data: ofUpgrade } : undefined)
          ? undefined
          : new Response("no"),
      websocket: {
        open(socket) {
          const first = socket.data;
          socket.data = storedLater;
          (first === undefined ? openedBare : opened).resolve([first, socket.data]);
          socket.close();
        },
        message() {},
      },
    });
    new WebSocket(`ws://127.0.0.1:${server.port}/?with`);
    const [first, second] = await opened.promise;
    expect(first).toBe(ofUpgrade);
    expect(second).toBe(storedLater);
    new WebSocket(`ws://127.0.0.1:${server.port}/`);
    expect(await openedBare.promise).toEqual([undefined, storedLater]);
  });

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

  // The compiler takes what these four are handed in place of an error to let no object of an unknown class exist, as what is thrown.
  test("Bun.listen | Bun.connect: close, error, connectError and handshake are handed an error, nothing, or what a handler threw", async () => {
    for (const row of ["Bun.listen", "Bun.connect"]) expect(overloadsOf({ row, mode: "Call" } as Case)).not.toBeEmpty();
    // Every row that takes the handlers of a socket says the same of them: those two, and the three of node:net and node:tls.
    const everyRow = dump.entries.flatMap(entry => entry.overloads);
    for (const handler of ["close", "error", "connectError", "handshake"]) {
      const last = everyRow
        .flatMap(overload => callsOfHandler(overload, `socket.${handler}`))
        .map(call => call.arguments.at(-1));
      expect(last.length).toBeGreaterThanOrEqual(5);
      expect(last).toEqual(last.map(() => expect.objectContaining({ place: "NewValue", holdsWhatIsThrown: true })));
    }
    const thrownByHandler = { tag: "made for this test" };
    const handed: Record<string, unknown[]> = { close: [], error: [], connectError: [], handshake: [] };
    const closed = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    const shaken = Promise.withResolvers<void>();
    const seen =
      (name: string, settled?: { resolve(): void }) =>
      (...operands: unknown[]) => {
        handed[name].push(operands.at(-1));
        settled?.resolve();
      };
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
      },
    });
    const refusedPort = listener.port;
    await Bun.connect({
      hostname: "127.0.0.1",
      port: listener.port,
      socket: {
        open() {
          throw thrownByHandler;
        },
        data() {},
        error: seen("error"),
        close: seen("close", closed),
      },
    });
    await closed.promise;
    listener.stop(true);
    await Bun.connect({
      hostname: "127.0.0.1",
      port: refusedPort,
      socket: { data() {}, connectError: seen("connectError", failed) },
    }).catch(() => {});
    await failed.promise;
    const secure = Bun.listen({ hostname: "localhost", port: 0, tls, socket: { data() {} } });
    const client = await Bun.connect({
      hostname: "localhost",
      port: secure.port,
      tls: { rejectUnauthorized: false },
      socket: { data() {}, handshake: seen("handshake", shaken) },
    });
    await shaken.promise;
    client.end();
    const trusted = Promise.withResolvers<void>();
    const trusting = await Bun.connect({
      hostname: "localhost",
      port: secure.port,
      tls: { ca: tls.cert },
      socket: { data() {}, handshake: seen("handshake", trusted) },
    });
    await trusted.promise;
    trusting.end();
    secure.stop(true);
    // What a handler answers counts as thrown where it is an error, and so does what native code threw inside a handler.
    const answeredByHandler = new RangeError("made for this test");
    for (const open of [() => answeredByHandler, () => void atob("*")]) {
      const told = Promise.withResolvers<void>();
      const refusing = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { open, data() {}, error: seen("error", told) },
      });
      const asking = await Bun.connect({ hostname: "127.0.0.1", port: refusing.port, socket: { data() {} } });
      await told.promise;
      asking.end();
      refusing.stop(true);
    }
    expect(handed.error).toEqual([thrownByHandler, answeredByHandler, expect.any(DOMException)]);
    expect(handed.error[0]).toBe(thrownByHandler);
    expect(handed.error[1]).toBe(answeredByHandler);
    expect(handed.close).toEqual([undefined]);
    expect(handed.connectError).toEqual([expect.any(Error)]);
    expect(handed.handshake).toEqual([expect.any(Error), null]);
    for (const error of [...handed.connectError, handed.handshake[0]])
      expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
  });

  test("Bun.serve: `error` and the `error` of its websockets are handed what another handler threw, the reason of its promise, or an error that native code made", async () => {
    const rows = overloadsOf({ row: "Bun.serve", mode: "Call" } as Case);
    expect(rows).not.toBeEmpty();
    for (const handler of ["error", "websocket.error", "webSocket.error"]) {
      const first = rows.flatMap(overload => callsOfHandler(overload, handler)).map(call => call.arguments[0]);
      expect(first).not.toBeEmpty();
      expect(first).toEqual(first.map(() => expect.objectContaining({ place: "NewValue", holdsWhatIsThrown: true })));
    }
    const thrownByHandler = { tag: "thrown by fetch" };
    const reasonOfPromise = { tag: "the reason of the promise that fetch answered" };
    const thrownInSocket = { tag: "thrown by open" };
    const handed: unknown[] = [];
    const receivers: unknown[] = [];
    const toldOfSocket = Promise.withResolvers<unknown[]>();
    using server = Bun.serve({
      port: 0,
      fetch(request, self) {
        const { pathname } = new URL(request.url);
        if (pathname === "/throws") throw thrownByHandler;
        if (pathname === "/rejects") return Promise.reject(reasonOfPromise);
        if (pathname === "/socket") return self.upgrade(request) ? undefined : new Response("no");
        return Response.error();
      },
      error(this: unknown, error: unknown) {
        receivers.push(this);
        handed.push(error);
        return new Response("told");
      },
      websocket: {
        open() {
          throw thrownInSocket;
        },
        message() {},
        error: (...operands: unknown[]) => toldOfSocket.resolve(operands),
      },
    } as any);
    for (const path of ["throws", "rejects", "cannot-be-sent"])
      expect(await (await fetch(`http://127.0.0.1:${server.port}/${path}`)).text()).toBe("told");
    new WebSocket(`ws://127.0.0.1:${server.port}/socket`);
    expect((await toldOfSocket.promise)[0]).toBe(thrownInSocket);
    expect(handed).toEqual([thrownByHandler, reasonOfPromise, expect.any(Error)]);
    expect(handed[0]).toBe(thrownByHandler);
    expect(handed[1]).toBe(reasonOfPromise);
    expect(Object.getPrototypeOf(handed[2])).toBe(Error.prototype);
    const typesOfReceiver = distinct(rows.flatMap(handedToHandler("error", "this")));
    expect(typesOfReceiver).not.toBeEmpty();
    for (const type of typesOfReceiver) expect(type.isAnything || type.hasAnyObject).toBeFalse();
    for (const receiver of receivers) {
      expect(receiver).toBe(server);
      expect(typesOfReceiver.map(type => mismatchOf(type, { value: receiver }))).toContain(undefined);
    }
  });

  // The compiler takes a program that loads bun:ffi to make no object of a class that nobody names, and native code behind it to call nothing of the library.
  test.skipIf(isWindows)(
    "Bun.FFI: every row says what native code makes, and the judge tells it from anything else",
    () => {
      const rows = [
        "callback",
        "cfunction",
        "closeCallback",
        "dlopen",
        "linkSymbols",
        "viewSource",
        "ptr",
        "toArrayBuffer",
        "toBuffer",
        "CString",
      ].map(name => `Bun.FFI.${name}`);
      for (const row of [
        ...rows,
        "%FFI%.prototype.symbols",
        "%FFI%.prototype.close",
        "%FFICallback%.prototype.close",
      ]) {
        const all = dump.entries.filter(entry => entry.path === row).flatMap(entry => entry.overloads);
        expect(all).not.toBeEmpty();
        expect(
          all
            .filter(
              overload => overload.isUndeclared || overload.result.type.isAnything || overload.result.type.hasAnyObject,
            )
            .map(overload => overload.token),
        ).toEqual([]);
      }
      expect(Reflect.ownKeys(ffi).map(String).sort()).toEqual(
        [...rows.map(row => row.slice("Bun.FFI.".length)), "read"].sort(),
      );
      prototypeOfCallbacks();
      const [made] = overloadsOf({ row: "native:Bindgen:ffi.bind.ts:makeCallback", mode: "Call" } as Case).map(
        row => row.result.type,
      );
      for (const value of [{}, () => {}, new Error("made for this test"), linkAndClose().linked, null, 5])
        expect(mismatchOf(made, { value })).toBeString();
    },
  );

  test.skipIf(isWindows)(
    "%FFICallback%: its prototype has `close` alone and stands below Object.prototype, and bun:ffi lays each callback below a class of its own",
    () => {
      const prototype = prototypeOfCallbacks();
      expect(Reflect.ownKeys(prototype)).toEqual(["close"]);
      expect(Reflect.getPrototypeOf(prototype)).toBe(Object.prototype);
      const close = Reflect.get(prototype, "close");
      for (const receiver of [undefined, {}, prototype, linkAndClose().linked])
        expect(() => Reflect.apply(close, receiver, [])).toThrow(TypeError);
      const made = ffi.callback({}, () => {});
      expect(Reflect.ownKeys(made).sort()).toEqual(["ptr", "threadsafe"]);
      expect([typeof made.ptr, made.threadsafe]).toEqual(["number", false]);
      Reflect.apply(close, made, []);
      expect(made.ptr).toBeNull();
      const { JSCallback } = require("bun:ffi");
      const wrapped = new JSCallback(() => {}, {});
      expect(Reflect.getPrototypeOf(wrapped)).toBe(JSCallback.prototype);
      expect(realm.classesOf(wrapped)).toContain("FFICallback");
      wrapped.close();
      expect(wrapped.ptr).toBeNull();
    },
  );

  test("the parameters of a routed request are the objects that the table says the host makes", async () => {
    const aboveObjectOf = (cell: string) => dump.hostObjects.find(object => object.cell === cell)!.prototype;
    const aboveEntry = (path: string) => dump.entries.find(entry => entry.path === path)!.inheritsFrom;
    const request = await routedRequest("/:name/:other", "/a/b");
    const named = Reflect.get(request, "params");
    const above = Reflect.getPrototypeOf(named)!;
    const tag = Reflect.getPrototypeOf(above)!;
    expect(Reflect.get(request, "params")).toBe(named);
    expect(Reflect.ownKeys(named).map(name => [name, Reflect.get(named, name)])).toEqual([
      ["name", "a"],
      ["other", "b"],
    ]);
    expect([Reflect.ownKeys(above), Reflect.ownKeys(tag), Reflect.get(tag, Symbol.toStringTag)]).toEqual([
      [],
      [Symbol.toStringTag],
      "RequestParams",
    ]);
    expect(Reflect.getPrototypeOf(tag)).toBeNull();
    expect([
      aboveObjectOf("BunRequest.params"),
      aboveEntry("%RequestParamsPrototype%"),
      aboveEntry("%RequestParamsTag%"),
    ]).toEqual(["RequestParamsPrototype", "RequestParamsTag", null]);
    const unnamed = Reflect.get(await routedRequest("/a"), "params");
    expect([Reflect.ownKeys(unnamed), Reflect.getPrototypeOf(unnamed)]).toEqual([[], null]);
    expect(aboveObjectOf("BunRequest.paramsOfRouteWithoutAny")).toBeNull();
  });

  test.skipIf(isWindows)("Bun.FFI.CString: called or constructed it answers a text, and no object", () => {
    const text = Buffer.from("text\0");
    const address = ffi.ptr(text);
    expect([
      ffi.CString(address),
      Reflect.construct(ffi.CString, [address]),
      Reflect.construct(ffi.CString, [0]),
      ffi.CString(address, 1, 2),
    ]).toEqual(["text", "text", "", "ex"]);
  });

  test("the formatter reads every getter of native code above what it prints, but for the classes that it prints by code of its own", () => {
    const gettersAbove = (prototype: string) =>
      dump.entries
        .filter(entry => entry.kind === "Accessor" && entry.holder === prototype && !entry.isSymbolName)
        .map(entry => entry.name);
    const timer = setTimeout(() => {}, 0);
    const immediate = setImmediate(() => {});
    clearTimeout(timer);
    clearImmediate(immediate);
    const printedByTheirOwnCode: [string, unknown][] = [
      ["TimeoutPrototype", timer],
      ["ImmediatePrototype", immediate],
      ["BlobPrototype", new Blob(["made up"])],
      ["RequestPrototype", new Request("http://made.up/")],
      ["ResponsePrototype", new Response("made up")],
    ];
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const walked: [string, unknown][] = [
      ["AbortSignalPrototype", new AbortController().signal],
      ["TextDecoderPrototype", new TextDecoder()],
      ["ListenerPrototype", listener],
    ];
    const namesLeftOut = ([prototype, instance]: [string, unknown]) => {
      const names = gettersAbove(prototype);
      expect(names).not.toBeEmpty();
      const printed = Bun.inspect(instance);
      return names.filter(name => !printed.includes(`${name}: `));
    };
    try {
      for (const one of printedByTheirOwnCode) expect(namesLeftOut(one)).not.toBeEmpty();
      for (const one of walked) expect(namesLeftOut(one)).toEqual([]);
    } finally {
      listener.stop(true);
    }
  });

  // The judge refuses: a type without any part takes in nothing.
  test("a type that says nothing takes in no value", () => {
    for (const value of [undefined, null, 0, "", {}, () => {}, new Error("made for this test")])
      expect(mismatchOf(never, { value })).toBeString();
  });
}

defineTests();
