// A view of a few bytes keeps them in its own cell. Native code that wants an ArrayBuffer of them, or pins them, moves them out, and what compiled code knows of where they lie is void behind the call: a row
// of the table of built-ins that may be believed with a view among its operands says so by writing TypedArrayStorage. Here plain Bun calls every such row with a small view in each place that names a class
// of views, and sees the move by what the cell weighs. A row that takes bytes in a place that may be any object is called where `routes` has a call for it.
//
//   bun small-views.ts <aot_builtin_table.json> [<path>]      the last line that it prints is `SmallViewsFound` below, as JSON; the rows of <path> are read as if they did not write TypedArrayStorage
import { deserialize, estimateShallowMemoryUsageOf, serialize } from "bun:jsc";
import { readTable, type Entry, type Overload, type Parameter, type TableType } from "./table";

export interface SmallViewsFound {
  /** Paths with a row of the kind, and of them those where a call came back without a throw. */
  paths: number;
  called: number;
  /** `<path> <operand>`: the bytes moved and the row does not write TypedArrayStorage. */
  silent: string[];
  /** The bytes moved and the row says so: the scales work. */
  saysSo: string[];
  /** Paths that no call reached, or where every call threw, and of which `notCalled` below says nothing: nothing is known of them. */
  notHeld: string[];
  /** Classes whose sample does not keep its bytes in the cell: the scales see nothing of them. */
  blind: string[];
}

type Row = Overload & {
  capability: string;
  runsOnlyOperandCode: boolean;
  reads: string[];
  writes: string[];
  handlerCalls: { times?: string }[];
  implementation: { how: string; function?: string };
};
type Operand = Parameter & { converted: TableType | null };
type Listed = Entry & { token: string; flags: string[]; isSymbolName: boolean };

const table = readTable(process.argv[2]);
const writesStorage = (row: Row) => row.writes.includes("TypedArrayStorage") && row.path !== process.argv[3];
const entries = new Map((table.entries as Listed[]).map(entry => [entry.token, entry]));
const parents = new Map(table.classes.map(each => [each.token, each.parent]));
const TypedArray = Object.getPrototypeOf(Uint8Array);

function isClassOfViews(name: string | null | undefined): boolean {
  for (; name; name = parents.get(name)) if (name === "TypedArray") return true;
  return false;
}

function classOfViewsIn(type: TableType | null): string | null {
  if (type === null || type.isAnything || type.hasAnyObject) return null;
  for (const part of type.parts) {
    if (part.part === "Instance" && isClassOfViews(part.class)) return part.class!;
    if (part.part === "InstanceOfReceiverClass" || part.part === "TypedArrayOfReceiverElementType") return "Uint8Array";
  }
  return null;
}

const has = (list: string[], ...names: string[]) => names.some(name => list.includes(name));
const isNamedByClassAlone = (type: TableType) =>
  !type.isAnything &&
  !type.hasAnyObject &&
  !type.hasPlainData &&
  type.parts.every(part => part.part === "Instance" && !part.contents?.length);

/** What the three readers of a row ask before they believe it: facts/AOTLinkEffects.cpp, walk/AOTWalkBuiltins.cpp effectsOfRow(), walk/AOTWalkStringFolds.cpp. */
function mayBeBelieved(entry: Listed, row: Row): boolean {
  if (has(entry.flags, "EvaluatesText", "LoadsModuleByName", "RunsUnseenCode")) return false;
  if (row.isUndeclared || (row.capability === "js" && !row.runsOnlyOperandCode)) return false;
  if (has([row.implementation.how], "Library", "LibraryFunction") || row.implementation.function) return false;
  if (row.handlerCalls.some(call => call.times !== "Later" && call.times !== "PerEvent")) return false;
  const uses = operandsOf(row).flatMap(operand => operand.uses);
  const changes = has(
    uses,
    "WritesContents",
    "MovesElements",
    "StoresByKey",
    "DeletesByKey",
    "AssignsFrom",
    "DefinesName",
    "TakesDescriptor",
    "ChangesIntegrity",
    "ChangesPrototype",
  );
  return !(changes && row.writes.length === 0) && !(has(uses, "ReadsContents") && row.reads.length === 0);
}

const operandsOf = (row: Row) => [row.receiver, ...row.parameters].filter(each => each !== null) as Operand[];

function classOfViewsTakenBy(operand: Operand): string | null {
  if (has(operand.uses, "StoresByKey", "DeletesByKey", "AssignsFrom", "TakesDescriptor")) return null;
  if (has(operand.uses, "AppliesTransitively", "AppliesToContents") && operand.protocols.length > 0) return null;
  if (has(operand.roles, "DescribedWhenRefused") && !isNamedByClassAlone(operand.accepted)) return null;
  return classOfViewsIn(operand.accepted) ?? classOfViewsIn(operand.converted);
}

const roots: Record<string, unknown> = { "globalThis": globalThis, "%TypedArray%": TypedArray };
const reached = new Map<string, unknown>();
function reach(token: string): unknown {
  if (reached.has(token)) return reached.get(token);
  reached.set(token, undefined);
  const entry = entries.get(token)!;
  let value: unknown;
  try {
    if (entry.path in roots) value = roots[entry.path];
    else if (entry.holder === null) value = /^[a-z@][\w:/@-]*$/.test(entry.path) ? require(entry.path) : undefined;
    else {
      const holder = reach(entry.holder);
      if (Object(holder) === holder && !entry.isSymbolName && Object.hasOwn(holder as object, entry.name))
        value =
          entry.kind === "Accessor" ? Object.getOwnPropertyDescriptor(holder, entry.name) : (holder as any)[entry.name];
    }
  } catch {}
  reached.set(token, value);
  return value;
}

function makeView(name: string): ArrayBufferView {
  if (name === "Buffer") return Buffer.alloc(8, 97);
  const constructor = name === "TypedArray" ? Uint8Array : (globalThis as any)[name];
  return new constructor(8);
}

const none = Symbol();
function sampleOf(operand: Operand): unknown {
  const type = operand.accepted;
  const views = classOfViewsIn(type) ?? classOfViewsIn(operand.converted);
  if (views !== null) return makeView(views);
  if (type.stringLiterals.length > 0) return type.stringLiterals[0];
  if (type.integers !== null) return Math.max(type.integers.minimum, Math.min(1, type.integers.maximum));
  for (const [primitive, sample] of [
    ["String", "a"],
    ["Number", 1],
    ["BigInt", 1n],
    ["Boolean", false],
    ["Undefined", undefined],
    ["Null", null],
  ] as const)
    if (type.primitives.some(each => each.startsWith(primitive))) return sample;
  if (type.hasAnyFunction) return () => 0;
  if (type.isAnything || type.hasAnyObject || type.hasPlainData) return operand.mode === "Required" ? {} : undefined;
  return none;
}

const bytesOf = (text: string) => Uint8Array.from(text, character => character.charCodeAt(0));
const eight = () => new Uint8Array(8);
const emptyModule = () => Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const { StringDecoder } = require("node:string_decoder");
const nodeCrypto = require("node:crypto");
const bcrypt = { algorithm: "bcrypt", cost: 4 } as const;

/** Calls written by hand: for a receiver or operands that the types of the row do not say how to make, and for rows that no name leads to, through the function of the library that hands its operands on. */
type Route = [call: (view: any) => unknown, view?: () => ArrayBufferView];
const timingSafeEqual: Route[] = [
  [view => nodeCrypto.timingSafeEqual(view, eight())],
  [view => nodeCrypto.timingSafeEqual(eight(), view)],
];
const crc32: Route[] = [[view => require("node:zlib").crc32(view)]];
const routes: Record<string, Route[]> = {
  "native:Bindgen:Crypto.bind.ts:timingSafeEqual": timingSafeEqual,
  "%NativeFunctions%.CryptoBindTsTimingSafeEqual": timingSafeEqual,
  "native:Bindgen:node_zlib_binding.bind.ts:crc32": crc32,
  "%NativeFunctions%.Node_zlib_bindingBindTsCrc32": crc32,
  "%NodeCryptoBindingCrypto%.pbkdf2Sync": [
    [view => nodeCrypto.pbkdf2Sync(view, eight(), 1, 8, "sha1")],
    [view => nodeCrypto.pbkdf2Sync(eight(), view, 1, 8, "sha1")],
  ],
  "%NodeCryptoBindingCrypto%.scryptSync": [
    [view => nodeCrypto.scryptSync(view, eight(), 8, { N: 2 })],
    [view => nodeCrypto.scryptSync(eight(), view, 8, { N: 2 })],
  ],
  "%NodeCryptoBindingCrypto%.argon2Sync": [
    [
      view =>
        nodeCrypto.argon2Sync("argon2id", {
          message: view,
          nonce: eight(),
          parallelism: 1,
          tagLength: 8,
          memory: 8,
          passes: 1,
        }),
    ],
    [
      view =>
        nodeCrypto.argon2Sync("argon2id", {
          message: eight(),
          nonce: view,
          parallelism: 1,
          tagLength: 8,
          memory: 8,
          passes: 1,
        }),
    ],
  ],
  "%NodeCryptoBindingCrypto%.randomFillSync": [[view => nodeCrypto.randomFillSync(view)]],
  "bun:jsc.deserialize": [[view => deserialize(view), () => Uint8Array.from(new Uint8Array(serialize(1)))]],
  "node:string_decoder.StringDecoder.prototype.write": [[view => new StringDecoder().write(view)]],
  "node:string_decoder.StringDecoder.prototype.end": [[view => new StringDecoder().end(view)]],
  "WebAssembly.Module": [[view => new WebAssembly.Module(view), emptyModule]],
  "WebAssembly.validate": [[view => WebAssembly.validate(view), emptyModule]],
  "BigInt64Array": [[view => new BigInt64Array(view), () => new BigInt64Array(1)]],
  "BigUint64Array": [[view => new BigUint64Array(view), () => new BigUint64Array(1)]],
  "%SecureContext%.prototype.setTicketKeys": [
    [view => require("node:tls").createSecureContext().context.setTicketKeys(view), () => new Uint8Array(48)],
  ],
  "Blob.prototype.write": [[view => Bun.file("written").write(view)]],
  "Bun.CryptoHasher": [[view => new Bun.CryptoHasher("sha256", view)]],
  "Bun.CryptoHasher.hash": [
    [view => Bun.CryptoHasher.hash("sha1", view)],
    [view => Bun.CryptoHasher.hash("sha1", "a", view), () => new Uint8Array(20)],
  ],
  "Bun.CryptoHasher.prototype.update": [[view => new Bun.CryptoHasher("sha1").update(view)]],
  "Bun.CryptoHasher.prototype.digest": [[view => new Bun.CryptoHasher("sha1").digest(view), () => new Uint8Array(20)]],
  "Bun.JSON5.parse": [[view => Bun.JSON5.parse(view), () => bytesOf("[1]")]],
  "Bun.JSONL.parse": [[view => Bun.JSONL.parse(view), () => bytesOf("[1]")]],
  "Bun.TOML.parse": [[view => Bun.TOML.parse(view), () => bytesOf("a = 1")]],
  "Bun.gunzipSync": [[view => Bun.gunzipSync(view), () => Uint8Array.from(Bun.gzipSync("a"))]],
  "Bun.inflateSync": [[view => Bun.inflateSync(view), () => Uint8Array.from(Bun.deflateSync("a"))]],
  "Bun.zstdDecompressSync": [[view => Bun.zstdDecompressSync(view), () => Uint8Array.from(Bun.zstdCompressSync("a"))]],
  "Bun.password.hashSync": [[view => Bun.password.hashSync(view, bcrypt)]],
  "Bun.password.verifySync": [[view => Bun.password.verifySync(view, Bun.password.hashSync("a", bcrypt))]],
  "Bun.randomUUIDv5": [
    [view => Bun.randomUUIDv5(view, "dns")],
    [view => Bun.randomUUIDv5("a", view), () => new Uint8Array(16)],
  ],
  "Crypto.prototype.timingSafeEqual": [
    [view => crypto.timingSafeEqual(view, eight())],
    [view => crypto.timingSafeEqual(eight(), view)],
  ],
  "TextDecoder.prototype.decode": [[view => new TextDecoder().decode(view)]],
  "TextEncoder.prototype.encodeInto": [[view => new TextEncoder().encodeInto("a", view)]],
  "Uint8Array.prototype.setFromBase64": [[view => view.setFromBase64("AAAA")]],
  "Uint8Array.prototype.setFromHex": [[view => view.setFromHex("00")]],
};
for (const name of ["MD4", "MD5", "SHA1", "SHA224", "SHA256", "SHA384", "SHA512", "SHA512_256"] as const) {
  routes[`Bun.${name}.prototype.update`] = [[view => new Bun[name]().update(view)]];
  routes[`Bun.${name}.prototype.digest`] = [[view => new Bun[name]().digest(view), () => new Uint8Array(64)]];
}

const notCalled: Record<string, string> = {
  "%TypedArray%": "it throws whatever it is handed",
  "%LinkTimeConstant:isTypedArrayOutOfBounds%": "no name of a program leads to it",
  "%CompilerHelpers%.newResponseFromParts": "no name of a program leads to it",
  "Atomics.wait": "it asks for shared memory, which never lies in the cell",
  "Atomics.waitAsync": "it asks for shared memory, which never lies in the cell",
};
const isForTestsOfBunAlone = (path: string) => /(ArchiveInternals|InternalSourceMap|[Bb]un_string_jsc)/.test(path);

function callWith(entry: Listed, row: Row, taker: Operand, view: ArrayBufferView): boolean {
  const callee = reach(entry.token) as any;
  if (callee === undefined) return false;
  const valueFor = (operand: Operand) => (operand === taker ? view : sampleOf(operand));
  const last = row.parameters.findLastIndex(each => each === taker || each.mode === "Required");
  const operands = (row.parameters.slice(0, last + 1) as Operand[]).map(valueFor);
  const receiver = row.receiver === null ? reach(entry.holder ?? "") : valueFor(row.receiver as Operand);
  if (operands.includes(none) || receiver === none) return false;
  try {
    if (row.mode === "Construct") Reflect.construct(callee, operands);
    else if (row.mode === "Get") Reflect.apply(callee.get, receiver, []);
    else if (row.mode === "Set") Reflect.apply(callee.set, receiver, operands);
    else Reflect.apply(callee, receiver, operands);
    return true;
  } catch {
    return false;
  }
}

const nameOf = (operand: Operand) => (operand.operand === "this" ? "this" : String(Object.values(operand.operand)[0]));

const found: SmallViewsFound = { paths: 0, called: 0, silent: [], saysSo: [], notHeld: [], blind: [] };
const weighed = new Set<string>();
for (const entry of entries.values()) {
  let isOfTheKind = false;
  let cameBack = false;
  let saysSo = true;
  for (const row of entry.overloads as Row[]) {
    if (!mayBeBelieved(entry, row)) continue;
    if (entry.path in routes) {
      isOfTheKind = true;
      saysSo &&= writesStorage(row);
      continue;
    }
    for (const taker of operandsOf(row)) {
      const views = classOfViewsTakenBy(taker);
      if (views === null) continue;
      isOfTheKind = true;
      if (!weighed.has(views)) {
        weighed.add(views);
        const twin = makeView(views) as Uint8Array;
        const weight = estimateShallowMemoryUsageOf(twin);
        twin.buffer;
        if (estimateShallowMemoryUsageOf(twin) >= weight) found.blind.push(views);
      }
      const view = makeView(views);
      const weight = estimateShallowMemoryUsageOf(view);
      if (callWith(entry, row, taker, view)) cameBack = true;
      if (estimateShallowMemoryUsageOf(view) >= weight) continue;
      const list = writesStorage(row) ? found.saysSo : found.silent;
      const line = `${entry.path} ${nameOf(taker)}`;
      if (!list.includes(line)) list.push(line);
    }
  }
  if (!isOfTheKind) continue;
  (routes[entry.path] ?? []).forEach(([call, make = eight], index) => {
    const view = make();
    const weight = estimateShallowMemoryUsageOf(view);
    try {
      call(view);
      cameBack = true;
    } catch {}
    if (estimateShallowMemoryUsageOf(view) < weight)
      (saysSo ? found.saysSo : found.silent).push(`${entry.path} by hand ${index}`);
  });
  ++found.paths;
  if (cameBack) ++found.called;
  else if (!(entry.path in notCalled) && !isForTestsOfBunAlone(entry.path)) found.notHeld.push(entry.path);
}
console.log(JSON.stringify(found));
process.exit(0);
