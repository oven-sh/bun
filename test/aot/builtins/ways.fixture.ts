// Asks the live objects of the Bun that runs this file what the table of built-ins says of them, and prints what differs: ways.test.ts.
// The file stands alone, so that it can be made into an executable.
import { aotBuiltinEntries, aotBuiltinMismatches } from "bun:internal-for-testing";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DumpedEntry,
  DumpedHostObject,
  DumpedLayout,
  DumpedPlace,
  DumpedType,
  TableDump,
} from "../../../src/codegen/builtins/dump.ts";

const { entries, classes, layouts, hostObjects }: TableDump = aotBuiltinEntries();
const entryOf = new Map(entries.map(entry => [entry.token, entry]));
const classOf = new Map(classes.map(one => [one.token, one]));
const layoutOf = new Map(layouts.map(one => [one.token, one]));
const classOfPrototype = new Map(classes.flatMap(one => (one.prototype ? [[one.prototype, one] as const] : [])));
const platform = { linux: "Linux", darwin: "Darwin", win32: "Windows", freebsd: "FreeBSD", android: "Android" }[
  process.platform as string
];

const lines = new Set<string>();
const counts = { members: 0, values: 0, accessors: 0, readsOfInstances: 0, sameObjects: 0, hostObjects: 0, modules: 0 };
const report = (path: string, text: string) => lines.add(`${path}: ${text}`);
const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
function attempt<T>(make: () => T): T | undefined {
  try {
    return make();
  } catch {}
}

const scratch = mkdtempSync(join(tmpdir(), "aot-ways-"));
writeFileSync(join(scratch, "probe.cjs"), "exports.module = module; exports.require = require;\n");
writeFileSync(join(scratch, "text.txt"), "text\n");
const requireHere = createRequire(import.meta.url);
const probe = requireHere(join(scratch, "probe.cjs"));

// ways.test.ts has to see that a false line of the table is found.
if (process.env.AOT_WAYS_BREAKS) {
  Object.defineProperty(process, "pid", { value: "text", configurable: true });
  Object.defineProperty(process, "arch", { value: "mips", configurable: true });
  Reflect.set(process.versions, "made-up", 5);
  Reflect.set(process.release, "made-up", "text");
  Object.defineProperty(URL.prototype, "port", { get: () => 80, configurable: true });
  Object.defineProperty(Number, "parseFloat", { value: () => 0, configurable: true, writable: true });
}

// The objects that no path from the global object leads to.
const hiddenRoots = new Map<string, unknown>([
  ["%ImportMeta%", import.meta],
  ["%ModuleObject%", probe.module],
  ["%ModuleRequire%", probe.require],
  ["%ModuleRequirePrototype%", Object.getPrototypeOf(probe.require)],
]);

const instances = new Map<string, object[]>();
function keep(token: string, value: unknown) {
  if (!isObject(value)) return;
  if (!instances.has(token)) instances.set(token, []);
  instances.get(token)!.push(value);
}

const found = new Map<string, unknown>();
// Reached through an instance that this file takes for one of the class: that a member is missing there says nothing.
const guessedPrototypes = new Set<object>();
const keyOf = (entry: DumpedEntry): PropertyKey =>
  entry.isSymbolName ? ((Reflect.get(Symbol, entry.name) as symbol | undefined) ?? Symbol.for(entry.name)) : entry.name;

function find(entry: DumpedEntry | undefined): unknown {
  if (!entry) return undefined;
  if (found.has(entry.token)) return found.get(entry.token);
  found.set(entry.token, undefined);
  const value = findAnew(entry);
  found.set(entry.token, value);
  return value;
}

function findAnew(entry: DumpedEntry): unknown {
  if (entry.token === "GlobalThis") return globalThis;
  if (hiddenRoots.has(entry.path)) return hiddenRoots.get(entry.path);
  if (/^(node|bun):[^.]*$/.test(entry.path)) return attempt(() => requireHere(entry.path));
  const holder = entry.holder ? find(entryOf.get(entry.holder)) : undefined;
  if (isObject(holder)) {
    const key = keyOf(entry);
    if (entry.isAddedAtFirstRead) attempt(() => Reflect.get(holder, key));
    const descriptor = attempt(() => Object.getOwnPropertyDescriptor(holder, key));
    if (descriptor && "value" in descriptor) return descriptor.value;
    if (descriptor?.get && entry.kind !== "Accessor") return attempt(() => descriptor.get!.call(holder));
  }
  const [instance] = instances.get(classOfPrototype.get(entry.token)?.token ?? "") ?? [];
  if (!instance) return undefined;
  const prototype = Object.getPrototypeOf(instance);
  guessedPrototypes.add(prototype);
  return prototype;
}

// Never process.execPath: in an executable that is this program.
const quietCommand = process.platform === "win32" ? ["cmd", "/c", "exit 0"] : ["/bin/sh", "-c", "exit 0"];
// To construct one of these starts a thread, opens a connection or evaluates text.
const neverConstructed =
  /^(Worker|WebSocket|EventSource|Proxy|Function|AsyncFunction|GeneratorFunction|AsyncGeneratorFunction|ShadowRealm)$/;
const operandLists: unknown[][] = [
  [],
  ["x"],
  [1],
  [{}],
  ["x", {}],
  [() => {}],
  [new ArrayBuffer(8)],
  ["sha256"],
  ["http://localhost/"],
  [[]],
];

// An accessor says the most where its object is in a state of its own: aborted, detached, empty, closed.
async function makeInstances(): Promise<() => void> {
  const by = (token: string, make: () => unknown) => keep(token, attempt(make));
  by("Timeout", () => {
    const timer = setTimeout(() => {}, 1);
    clearTimeout(timer);
    return timer;
  });
  by("Immediate", () => {
    const timer = setImmediate(() => {});
    clearImmediate(timer);
    return timer;
  });
  by("Stats", () => statSync(scratch));
  by("BigIntStats", () => statSync(scratch, { bigint: true }));
  by("Dirent", () => readdirSync(scratch, { withFileTypes: true })[0]);
  by("ResourceUsage", () => Bun.spawnSync({ cmd: quietCommand }).resourceUsage);
  by("Blob", () => Bun.file(join(scratch, "text.txt")));
  by("Blob", () => Bun.file(join(scratch, "no-such-file")));
  by("Blob", () => new Blob(["x"], { type: "text/plain" }));
  by("File", () => new File(["x"], "name.txt", { type: "text/plain", lastModified: 5 }));
  by("Request", () => new Request("http://localhost/x", { method: "POST", body: "x" }));
  by("Request", () => new Request("http://localhost/x"));
  by("Response", () => new Response("x", { status: 201, statusText: "made" }));
  by("Response", () => new Response());
  by("Response", () => Response.error());
  by("Response", () => Response.redirect("http://localhost/y"));
  by("Response", () => Response.json({}));
  by("URL", () => new URL("http://u:p@localhost:81/a/b?c=d#e"));
  by("URL", () => new URL("file:///x"));
  by("AbortSignal", () => new AbortController().signal);
  by("AbortSignal", () => AbortSignal.abort());
  by("AbortSignal", () => AbortSignal.abort("why"));
  by("Event", () => new Event("x"));
  by("CustomEvent", () => new CustomEvent("x", { detail: 1 }));
  by("CustomEvent", () => new CustomEvent("x"));
  by("MessageEvent", () => new MessageEvent("message", { data: 1 }));
  by("MessageEvent", () => new MessageEvent("message"));
  by("ErrorEvent", () => new ErrorEvent("error", { error: new Error("x"), message: "x" }));
  by("ErrorEvent", () => new ErrorEvent("error"));
  by("CloseEvent", () => new CloseEvent("close"));
  by("DOMException", () => new DOMException("x", "AbortError"));
  by("MessagePort", () => {
    const { port1, port2 } = new MessageChannel();
    port1.close();
    port2.close();
    return port1;
  });
  by("BroadcastChannel", () => {
    const channel = new BroadcastChannel("x");
    channel.close();
    return channel;
  });
  by("PerformanceMark", () => performance.mark("aot-ways"));
  by("PerformanceMeasure", () => performance.measure("aot-ways-2", "aot-ways"));
  by("ReadableStreamDefaultReader", () => new ReadableStream().getReader());
  by("ReadableStreamBYOBReader", () => new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" }));
  by("WritableStreamDefaultWriter", () => new WritableStream().getWriter());
  by("Buffer", () => Buffer.from("text"));
  by("CryptoHasher", () => new Bun.CryptoHasher("sha256"));
  by("Glob", () => new Bun.Glob("*"));
  by("Cookie", () => new Bun.Cookie("a", "b"));
  by(
    "Cookie",
    () => new Bun.Cookie("a", "b", { expires: new Date(5), maxAge: 5, domain: "x.y", path: "/p", sameSite: "strict" }),
  );
  by("CookieMap", () => new Bun.CookieMap("a=b"));
  by("RegExp", () => /x/dgimsuy);
  by("RegExp", () => /x/v);
  by("Error", () => new Error("x", { cause: 1 }));
  by("Date", () => new Date(NaN));
  by("ArrayBuffer", () => new ArrayBuffer(8, { maxByteLength: 16 }));
  by("ArrayBuffer", () => {
    const buffer = new ArrayBuffer(8);
    buffer.transfer();
    return buffer;
  });
  by("SharedArrayBuffer", () => new SharedArrayBuffer(8));
  by("DataView", () => new DataView(new ArrayBuffer(8), 2));
  by("Symbol", () => Object(Symbol("x")));
  by("Symbol", () => Object(Symbol()));
  by("Function", () => function named(_a: unknown, _b: unknown) {});
  by("Function", () => () => {});
  by("Function", () => function () {}.bind(null));
  by("Function", () => class {});
  for (const name of Object.getOwnPropertyNames(globalThis).filter(name =>
    /^(Big)?(Ui|I)nt\d+.*Array$|^Float/.test(name),
  )) {
    const constructor = Reflect.get(globalThis, name);
    by(name, () => new constructor(4));
    by(name, () => {
      const buffer = new ArrayBuffer(64);
      const view = new constructor(buffer);
      buffer.transfer();
      return view;
    });
  }
  const server = attempt(() => Bun.serve({ port: 0, fetch: () => new Response("x") }));
  keep(String(attempt(() => Object.getPrototypeOf(server)[Symbol.toStringTag])), server);
  for (const stdout of ["pipe", "ignore"] as const) {
    const child = attempt(() => Bun.spawn({ cmd: quietCommand, stdout, stderr: "ignore", stdin: "ignore" }));
    keep("Subprocess", child);
    await child?.exited;
  }
  // Whatever can be made of a constructor that a program can name.
  for (const one of classes) {
    if (!one.constructor || neverConstructed.test(one.token)) continue;
    const constructor = find(entryOf.get(one.constructor));
    if (typeof constructor !== "function") continue;
    let made = 0;
    for (const operands of operandLists) {
      const value = attempt(() => Reflect.construct(constructor, operands));
      if (!isObject(value) || typeof Reflect.get(value, "then") === "function") continue;
      keep(one.token, value);
      if (++made === 3) break;
    }
  }
  return () => void attempt(() => server?.stop(true));
}

const notKnown = Symbol("not known");
type Answer = boolean | typeof notKnown;

function isInstanceOf(value: object, token: string, isOfClassItself: boolean): Answer {
  const prototype = find(entryOf.get(classOf.get(token)?.prototype ?? ""));
  if (!isObject(prototype)) return notKnown;
  if (isOfClassItself) return Object.getPrototypeOf(value) === prototype;
  for (let at = Object.getPrototypeOf(value); at; at = Object.getPrototypeOf(at)) if (at === prototype) return true;
  return false;
}

function liesInside(type: DumpedType, value: unknown, depth = 0): Answer {
  if (type.isAnything) return true;
  switch (typeof value) {
    case "undefined":
      return type.primitives.includes("Undefined");
    case "boolean":
      return type.primitives.includes("Boolean");
    case "symbol":
      return type.primitives.includes("Symbol");
    case "bigint":
      return type.primitives.includes("BigInt");
    case "string":
      return type.primitives.includes("String") || type.stringLiterals.includes(value);
    case "number": {
      const range = type.integers;
      if (!type.primitives.includes("Number") || !range) return type.primitives.includes("Number");
      return Number.isInteger(value) && !Object.is(value, -0) && value >= range.minimum && value <= range.maximum;
    }
  }
  if (value === null) return type.primitives.includes("Null");
  if (type.hasAnyObject || (typeof value === "function" ? type.hasAnyFunction : type.hasPlainData)) return true;
  let isUnknown = false;
  for (const part of type.parts) {
    let answer: Answer = notKnown;
    if (part.part === "Instance") answer = isInstanceOf(value, part.class, part.isOfClassItself);
    else if (part.part === "Layout") answer = depth > 3 ? notKnown : hasLayout(value, layoutOf.get(part.layout), depth);
    else if (part.part === "Builtin" && entryOf.get(part.builtin)?.scope === "Realm") {
      const object = find(entryOf.get(part.builtin));
      if (isObject(object)) answer = object === value;
    }
    if (answer === true) return true;
    if (answer === notKnown) isUnknown = true;
  }
  return isUnknown ? notKnown : false;
}

function hasLayout(value: object, layout: DumpedLayout | undefined, depth: number): Answer {
  if (!layout) return notKnown;
  let isUnknown = false;
  for (const [index, field] of layout.fields.entries()) {
    const key = layout.isTuple || field.name === null ? index : field.name;
    if (!Object.hasOwn(value, key)) {
      if (field.isOptional) continue;
      return false;
    }
    const answer = liesInside(field.type, Reflect.get(value, key), depth + 1);
    if (answer === false) return false;
    if (answer === notKnown) isUnknown = true;
  }
  return isUnknown ? notKnown : true;
}

// Without what differs from one run or machine to the next.
function describe(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "undefined") return String(value);
  if (typeof value !== "object") return `a ${typeof value}`;
  return `an object of ${attempt(() => Object.getPrototypeOf(value)?.constructor?.name) ?? "no class"}`;
}

function describeType(type: DumpedType): string {
  const words: string[] = [...type.primitives, ...type.stringLiterals.map(text => JSON.stringify(text))];
  if (type.integers) words.push(`${type.integers.minimum}..${type.integers.maximum}`);
  if (type.hasAnyObject) words.push("object");
  if (type.hasAnyFunction) words.push("function");
  if (type.hasPlainData) words.push("plain data");
  for (const part of type.parts)
    words.push(part.part === "Instance" ? part.class : part.part === "Builtin" ? part.builtin : part.part);
  return words.join(" | ") || "nothing";
}

const hostObjectOf = new Map(
  hostObjects.flatMap(object =>
    object.function === null && object.platforms.some(name => name === platform)
      ? [[object.cell, object] as const]
      : [],
  ),
);
const spellingOf = (key: PropertyKey) =>
  typeof key !== "symbol"
    ? String(key)
    : Symbol.keyFor(key) === undefined
      ? `@@${key.description}`
      : `@@@${Symbol.keyFor(key)}`;

function mayHold(place: DumpedPlace, value: unknown): boolean {
  if (place.place === "NewValue") return liesInside(place.type, value) !== false;
  if (place.place === "NativeCell") return isObject(value);
  return place.place === "NativeMemory";
}

function describePlace(place: DumpedPlace): string {
  return place.place === "NewValue"
    ? describeType(place.type)
    : place.place === "NativeCell"
      ? place.cell
      : place.place;
}

// An object that native code makes by itself: what lies above it, which names it has and what each of them holds.
function holdHostObject(path: string, declared: DumpedHostObject, value: unknown) {
  counts.hostObjects++;
  if (!isObject(value)) return report(path, `is ${describe(value)}, and the table says the object of ${declared.cell}`);
  const above = declared.prototype === null ? null : find(entryOf.get(declared.prototype));
  if (Object.getPrototypeOf(value) !== above) report(path, "has another object above it than the table says");
  for (const key of Reflect.ownKeys(value)) {
    const name = spellingOf(key);
    if (declared.nativeAccessors.includes(name)) continue;
    const named = declared.fields.filter(field => field.name === name);
    const fields = named.length > 0 ? named : declared.fields.filter(field => field.name === null);
    // Which variables, versions and features there are differs from one machine to the next.
    const member = named.length > 0 ? `${path}.${name}` : `a member of ${path}`;
    if (fields.length === 0) {
      // Below the prototype of a class the object also has what the class defines on every instance.
      if (above === Object.prototype || above === null) report(member, "is none of the names that the table lists");
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) report(member, "is an accessor, and the table says native code puts a value there");
    else if (!fields.some(field => mayHold(field.value, descriptor.value)))
      report(
        member,
        `holds ${describe(descriptor.value)}, and the table says ${fields.map(field => describePlace(field.value)).join(" | ")}`,
      );
  }
}

function holdValue(entry: DumpedEntry, value: unknown, how: string, receiver?: object) {
  // The first overload that takes the receiver speaks.
  const overload = entry.overloads.find(
    ({ mode, receiver: declared }) =>
      mode === "Get" && !(declared && receiver && liesInside(declared.accepted, receiver) === false),
  );
  if (!overload) return;
  counts.values++;
  if (liesInside(overload.result.type, value) === false)
    report(entry.path, `${how} ${describe(value)}, and the table says ${describeType(overload.result.type)}`);
  const cells = overload.transfers.flatMap(({ from, to }) =>
    from.place === "NativeCell" && to.place === "Result" ? [hostObjectOf.get(from.cell)] : [],
  );
  if (cells.length === 1 && cells[0]) holdHostObject(entry.path, cells[0], value);
}

const stop = await makeInstances();

for (const entry of entries) {
  if (entry.kind === "NativeBinding" || !entry.holder || !entry.platforms.some(name => name === platform)) continue;
  if (entry.flags.includes("IsDefaultExport")) continue;
  const holderEntry = entryOf.get(entry.holder)!;
  const holder = find(holderEntry);
  if (!isObject(holder)) continue;
  const key = keyOf(entry);
  const instancesOfHolder = instances.get(classOfPrototype.get(entry.holder)?.token ?? "");
  if (entry.flags.includes("IsOwnPropertyOfInstances")) {
    for (const instance of instancesOfHolder ?? []) {
      const descriptor = attempt(() => Object.getOwnPropertyDescriptor(instance, key));
      if (!descriptor || !("value" in descriptor)) continue;
      counts.readsOfInstances++;
      holdValue(entry, descriptor.value, "an instance holds");
    }
    continue;
  }
  if (entry.isAddedAtFirstRead) attempt(() => Reflect.get(holder, key));
  let descriptor = attempt(() => Object.getOwnPropertyDescriptor(holder, key));
  // The objects of a module have some of their members one step up, as accessors of native code, and `import.meta` describes none of its own.
  // The table says what a program reads there.
  if (!descriptor && hiddenRoots.has(holderEntry.path) && key in holder) {
    counts.members++;
    holdValue(entry, Reflect.get(holder, key), "read gives", holder);
    continue;
  }
  if (!descriptor && guessedPrototypes.has(holder)) continue;
  counts.members++;
  if (!descriptor) {
    if (entry.mutability !== "ChangesOnItsOwn") report(entry.path, "is missing");
    continue;
  }
  if ("value" in descriptor) {
    const { value } = descriptor;
    if (entry.kind === "Accessor") report(entry.path, "is a data property, and the table says Accessor");
    if (/^(Function|Method|Constructor)$/.test(entry.kind) && typeof value !== "function")
      report(entry.path, `is ${describe(value)}, and the table says ${entry.kind}`);
    if (/^(Namespace|Prototype)$/.test(entry.kind) && !isObject(value))
      report(entry.path, `is ${describe(value)}, and the table says ${entry.kind}`);
    holdValue(entry, value, "holds");
  } else {
    // What changes on its own may be anything at every read, so it does not matter who answers.
    if (entry.kind !== "Accessor" && entry.mutability !== "ChangesOnItsOwn")
      report(entry.path, `is an accessor, and the table says ${entry.kind}`);
    counts.accessors++;
    for (const receiver of classOfPrototype.has(entry.holder) ? (instancesOfHolder ?? []) : [holder]) {
      let value: unknown;
      try {
        value = descriptor.get?.call(receiver);
      } catch {
        continue;
      }
      if (receiver !== holder) counts.readsOfInstances++;
      holdValue(entry, value, receiver === holder ? "read gives" : "read of an instance gives", receiver);
    }
  }
  // Every module has a `require` of its own.
  const sameAs = entryOf.get(entry.sameObjectAs ?? "");
  const other = sameAs?.scope === "Realm" ? find(sameAs) : undefined;
  if (!isObject(other)) continue;
  counts.sameObjects++;
  if (other !== ("value" in descriptor ? descriptor.value : attempt(() => descriptor.get?.call(holder))))
    report(entry.path, `is another object than ${sameAs!.path}, which the table says it is`);
}

// One object under two paths that nothing ties: the compiler takes them for two, so what is stored through the one is not seen by the reads
// of the other. Where the table says what the object holds those reads are not tested, and a value of another kind there is a crash.
{
  const cellOf = (entry: DumpedEntry) =>
    entry.overloads.flatMap(({ mode, transfers }) =>
      mode !== "Get" ? [] : transfers.flatMap(({ from }) => (from.place === "NativeCell" ? [from.cell] : [])),
    )[0];
  const saysWhatItHolds = (entry: DumpedEntry) =>
    (hostObjectOf.get(cellOf(entry) ?? "")?.fields.length ?? 0) > 0 ||
    entry.overloads.some(
      ({ mode, result }) =>
        mode === "Get" && result.type.parts.some(part => part.part === "Instance" && part.contents.length > 0),
    );
  const tieOf = (entry: DumpedEntry): string =>
    entry.sameObjectAs ? tieOf(entryOf.get(entry.sameObjectAs)!) : (cellOf(entry) ?? entry.token);
  const pathsOf = new Map<object, DumpedEntry[]>();
  for (const entry of entries) {
    const value = entry.kind === "NativeBinding" ? undefined : find(entry);
    if (isObject(value)) pathsOf.set(value, [...(pathsOf.get(value) ?? []), entry]);
  }
  for (const sameObject of pathsOf.values()) {
    if (new Set(sameObject.map(tieOf)).size > 1 && sameObject.some(saysWhatItHolds))
      report(
        sameObject
          .map(entry => entry.path)
          .sort()
          .join(" and "),
        "are one object, the table says what it holds, and nothing ties them",
      );
  }
}

// Two of those objects are handed to code of the program.
{
  const options = hostObjectOf.get("GlobalObject.utilInspectOptions");
  const inspected = {
    [Symbol.for("nodejs.util.inspect.custom")](_depth: number, given: unknown) {
      if (options) holdHostObject("the options of a method that says how its object is printed", options, given);
      return "";
    },
  };
  Bun.inspect(inspected);
  Bun.inspect([[inspected]], { colors: true, depth: 4 });
  const warning = hostObjectOf.get("Process.madeWarnings");
  process.on(
    "warning",
    made => warning && holdHostObject("the warning that process.emitWarning() makes", warning, made),
  );
  Reflect.set(process, "noProcessWarnings", true);
  process.emitWarning("text");
  process.emitWarning("text", { type: "Kind", code: "CODE", detail: "text" });
  await new Promise(resolve => setImmediate(resolve));
}

counts.modules = entries.filter(entry => /^(node|bun):[^.]*$/.test(entry.path) && isObject(find(entry))).length;
stop();
attempt(() => rmSync(scratch, { recursive: true, force: true }));
// The engine's own comparison comes last: its walk finds no object of a module that nobody has loaded.
console.log("ANSWER " + JSON.stringify({ held: [...lines].sort(), engine: aotBuiltinMismatches().sort(), counts }));
// What was made above may keep the process alive. A test run ends by itself.
if (!process.env.AOT_WAYS_STAYS) process.exit(0);
