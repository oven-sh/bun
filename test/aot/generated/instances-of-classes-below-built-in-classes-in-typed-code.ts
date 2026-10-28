// A class with fields, a method and an accessor stands below a built-in class. One operation is applied to an instance in a function whose parameter has the type of the class.
// Typed functions read, call and store through parameters of that type before and after, on that object, on another and on fresh ones, and what the objects hold is listed through untyped code, also behind collections.
export type Base = {
  /** What stands behind `extends`. */
  heritage: string;
  /** The arguments of `super`. */
  operands: string;
  /** An expression over `k` that says what the built-in part of the object holds. */
  holds: string;
  /** A statement over `k` that changes the built-in part of the object. */
  changes?: string;
  /** Statements ahead of the class. */
  before?: string;
};

export const bases: Record<string, Base> = {
  Map: { heritage: "Map<string, number>", operands: `[["a", 1], ["b", 2]]`, holds: `k.size + ":" + k.get("a") + ":" + k.has("z") + ":" + [...k.keys()].join()`, changes: `k.set("c", 3); k.delete("b");` },
  Set: { heritage: "Set<string>", operands: `["a", "b"]`, holds: `k.size + ":" + k.has("a") + ":" + [...k].join()`, changes: `k.add("c"); k.delete("b");` },
  WeakMap: { heritage: "WeakMap<object, number>", operands: `[[anchor, 1]]`, holds: `k.get(anchor) + ":" + k.has({})`, changes: `k.set(anchor, 2);`, before: `const anchor = {};` },
  WeakSet: { heritage: "WeakSet<object>", operands: `[anchor]`, holds: `k.has(anchor) + ":" + k.has({})`, changes: `k.delete(anchor);`, before: `const anchor = {};` },
  Error: { heritage: "Error", operands: `"text", { cause: 5 }`, holds: `k.message + ":" + k.name + ":" + String(k.cause) + ":" + typeof k.stack`, changes: `k.message = "other";` },
  TypeError: { heritage: "TypeError", operands: `"text"`, holds: `k.message + ":" + k.name + ":" + ("cause" in k) + ":" + typeof k.stack`, changes: `k.name = "Renamed";` },
  AggregateError: { heritage: "AggregateError", operands: `[new Error("inner")], "text"`, holds: `k.message + ":" + k.errors.length`, changes: `k.errors.push(1);` },
  Date: { heritage: "Date", operands: `86400000`, holds: `k.getTime() + ":" + k.toISOString()`, changes: `k.setTime(172800000);` },
  RegExp: { heritage: "RegExp", operands: `"a+", "g"`, holds: `k.source + ":" + k.flags + ":" + k.lastIndex + ":" + k.test("caab")`, changes: `k.lastIndex = 1;` },
  ArrayBuffer: { heritage: "ArrayBuffer", operands: `8`, holds: `k.byteLength + ":" + new Uint8Array(k).join()`, changes: `new Uint8Array(k)[1] = 7;` },
  DataView: { heritage: "DataView<ArrayBuffer>", operands: `new ArrayBuffer(8), 2`, holds: `k.byteLength + ":" + k.byteOffset + ":" + k.getUint8(0)`, changes: `k.setUint8(0, 9);` },
  Uint8Array: { heritage: "Uint8Array", operands: `[1, 2, 3]`, holds: `k.length + ":" + k[1] + ":" + k.join()`, changes: `k[1] = 9;` },
  Float64Array: { heritage: "Float64Array", operands: `2`, holds: `k.length + ":" + k[1] + ":" + k.join()`, changes: `k[1] = 0.5;` },
  Array: { heritage: "Array<number>", operands: `1, 2, 3`, holds: `k.length + ":" + k[1] + ":" + k.join()`, changes: `k.push(4); k[0] = 9;` },
  Promise: { heritage: "Promise<number>", operands: `(resolve: (value: number) => void) => resolve(1)`, holds: `typeof k.then + ":" + (k.then(() => 1) instanceof Kept)` },
  Object: { heritage: "Object", operands: ``, holds: `typeof k.valueOf()` },
  Function: { heritage: "Function", operands: `"return 4"`, holds: `typeof k + ":" + k.length + ":" + k()` },
  Boolean: { heritage: "Boolean", operands: `true`, holds: `String(k.valueOf())` },
  Number: { heritage: "Number", operands: `4`, holds: `k.toFixed(1)` },
  String: { heritage: "String", operands: `"text"`, holds: `k.length + ":" + k[1] + ":" + k.toUpperCase()` },
  WeakRef: { heritage: "WeakRef<object>", operands: `anchor`, holds: `String(k.deref() === anchor)`, before: `const anchor = {};` },
  EventTarget: { heritage: "EventTarget", operands: ``, holds: `String(k.dispatchEvent(new Event("e")))`, changes: `k.addEventListener("e", event => event.preventDefault());` },
  Event: { heritage: "Event", operands: `"e", { cancelable: true }`, holds: `k.type + ":" + k.defaultPrevented`, changes: `k.preventDefault();` },
  URL: { heritage: "URL", operands: `"http://a.example/b?c=1"`, holds: `k.href + ":" + k.searchParams.get("c")`, changes: `k.pathname = "/d";` },
  URLSearchParams: { heritage: "URLSearchParams", operands: `"a=1&b=2"`, holds: `k.toString() + ":" + k.get("a")`, changes: `k.set("a", "3");` },
  Headers: { heritage: "Headers", operands: `{ a: "1" }`, holds: `k.get("a") + ":" + k.has("b")`, changes: `k.set("b", "2");` },
  Response: { heritage: "Response", operands: `"body", { status: 201 }`, holds: `k.status + ":" + k.ok` },
  Blob: { heritage: "Blob", operands: `["text"]`, holds: `k.size + ":" + k.type` },
  AbortController: { heritage: "AbortController", operands: ``, holds: `String(k.signal.aborted)`, changes: `k.abort();` },
  TextDecoder: { heritage: "TextDecoder", operands: ``, holds: `k.encoding + ":" + k.decode(new Uint8Array([97]))` },
  EventEmitter: { heritage: "EventEmitter", operands: ``, holds: `k.listenerCount("e") + ":" + k.emit("e")`, changes: `k.on("e", () => {});`, before: `import { EventEmitter } from "node:events";` },
  Readable: { heritage: "Readable", operands: `{ read() {} }`, holds: `k.readable + ":" + k.readableFlowing`, changes: `k.pause();`, before: `import { Readable } from "node:stream";` },
};

// Over `k: Kept` and `other: Kept`. The result is printed.
export const operations: Record<string, string> = {
  "Object.freeze": `return Object.freeze(k) === k;`,
  "Object.seal": `return Object.seal(k) === k;`,
  "Object.preventExtensions": `return Object.preventExtensions(k) === k;`,
  "Reflect.preventExtensions": `return Reflect.preventExtensions(k);`,
  "Object.freeze twice": `Object.freeze(k); return Object.freeze(k) === k;`,
  "Object.freeze behind a new property": `(k as any).fresh = 1; return Object.freeze(k) === k;`,
  "Object.freeze, then stores": `"use strict"; Object.freeze(k); try { k.count = 9; return "stored"; } catch (e) { return (e as Error).name; }`,
  "Object.seal, then delete": `"use strict"; Object.seal(k); try { return delete k.note; } catch (e) { return (e as Error).name; }`,
  "Object.preventExtensions, then a store of the field that is left out": `"use strict"; Object.preventExtensions(k); try { k.late = "l"; return "stored"; } catch (e) { return (e as Error).name; }`,
  "the integrity is asked": `return [Object.isFrozen(k), Object.isSealed(k), Object.isExtensible(k), Reflect.isExtensible(k)].join();`,
  "Object.defineProperty of a field, a value": `return Object.defineProperty(k, "count", { value: 5 }) === k;`,
  "Object.defineProperty of a field, a text": `return Object.defineProperty(k, "count", { value: "s" }) === k;`,
  "Object.defineProperty of a field, a getter": `return Object.defineProperty(k, "count", { get() { return 9; }, configurable: true }) === k;`,
  "Object.defineProperty of a field, a getter of a text": `return Object.defineProperty(k, "count", { get() { return "g"; }, configurable: true }) === k;`,
  "Object.defineProperty of a field, read-only": `return Object.defineProperty(k, "count", { writable: false }) === k;`,
  "Object.defineProperty of a field, hidden": `return Object.defineProperty(k, "count", { enumerable: false }) === k;`,
  "Object.defineProperty of a new name": `return Object.defineProperty(k, "fresh", { value: 1, enumerable: true }) === k;`,
  "Object.defineProperty of the method's name": `return Object.defineProperty(k, "twice", { value: () => 77 }) === k;`,
  "Object.defineProperty of the accessor's name": `return Object.defineProperty(k, "half", { value: 78, writable: true }) === k;`,
  "Object.defineProperties": `return Object.defineProperties(k, { count: { value: 6 }, fresh: { value: 2 } }) === k;`,
  "Reflect.defineProperty": `return Reflect.defineProperty(k, "count", { value: 7 });`,
  "Object.setPrototypeOf, null": `return Object.setPrototypeOf(k, null) === k;`,
  "Object.setPrototypeOf, a literal": `return Object.setPrototypeOf(k, { twice() { return 70; }, half: 71 }) === k;`,
  "Object.setPrototypeOf, what it has": `return Object.setPrototypeOf(k, Kept.prototype) === k;`,
  "Object.setPrototypeOf, the parent's": `return Object.setPrototypeOf(k, Object.getPrototypeOf(Kept.prototype)) === k;`,
  "Object.setPrototypeOf, another class's": `return Object.setPrototypeOf(k, Stranger.prototype) === k;`,
  "Object.setPrototypeOf, there and back": `Object.setPrototypeOf(k, Stranger.prototype); return Object.setPrototypeOf(k, Kept.prototype) === k;`,
  "Reflect.setPrototypeOf": `return Reflect.setPrototypeOf(k, Stranger.prototype);`,
  "a store to __proto__": `(k as any).__proto__ = Stranger.prototype; return Object.getPrototypeOf(k) === Stranger.prototype;`,
  "Object.getPrototypeOf": `return Object.getPrototypeOf(k) === Kept.prototype;`,
  "Object.assign to it, a field": `return Object.assign(k, { count: 3 }) === k;`,
  "Object.assign to it, a text for a field": `return Object.assign(k, { count: "s" } as any) === k;`,
  "Object.assign to it, parsed data": `return Object.assign(k, JSON.parse('{"count":"p","fresh":1}')) === k;`,
  "Object.assign to it, a new name": `return Object.assign(k, { fresh: 3 }) === k;`,
  "Object.assign to it from the other": `other.count = 12; return Object.assign(k, other) === k;`,
  "Object.assign from it": `return JSON.stringify(Object.assign({}, k));`,
  "Object.assign from it to a literal with its names": `return JSON.stringify(Object.assign({ count: 0, label: "" }, k));`,
  "a spread of it": `return JSON.stringify({ ...k });`,
  "a spread of it with a member behind": `return JSON.stringify({ ...k, count: 2 });`,
  "a spread of it with a member ahead": `return JSON.stringify({ note: "ahead", fresh: 2, ...k });`,
  "taken apart": `const { count, label, note } = k; return count + ":" + label + ":" + note;`,
  "taken apart with a rest": `const { count, ...rest } = k; return count + ":" + JSON.stringify(rest);`,
  "structuredClone": `try { const clone = structuredClone(k); return Object.keys(clone).join() + ":" + (clone instanceof Kept) + ":" + Object.prototype.toString.call(clone); } catch (e) { return (e as Error).name; }`,
  "JSON.stringify": `return JSON.stringify(k);`,
  "JSON.stringify of a holder": `return JSON.stringify({ a: k, b: [k] });`,
  "JSON.stringify with a list of names": `return JSON.stringify(k, ["count", "label"]);`,
  "JSON.stringify with toJSON on the object": `(k as any).toJSON = function (this: Kept) { return this.count; }; return JSON.stringify(k);`,
  "for-in": `const names: string[] = []; for (const name in k) names.push(name); return names.join();`,
  "for-in that reads": `let text = ""; for (const name in k) { const value = (k as any)[name]; text += name + "=" + (typeof value === "function" || typeof value === "object" ? typeof value : String(value)) + ";"; } return text;`,
  "for-in that deletes": `const names: string[] = []; for (const name in k) { names.push(name); delete (k as any).label; } return names.join();`,
  "for-in that adds": `const names: string[] = []; for (const name in k) { names.push(name); (k as any).fresh = 1; } return names.join();`,
  "Object.keys": `return Object.keys(k).join();`,
  "Object.keys, the number": `return Object.keys(k).length;`,
  "Object.values": `return Object.values(k).join();`,
  "Object.entries": `return JSON.stringify(Object.entries(k));`,
  "Object.getOwnPropertyNames": `return Object.getOwnPropertyNames(k).filter(name => name !== "stack" && name !== "line" && name !== "column" && name !== "sourceURL").join();`,
  "Object.getOwnPropertySymbols": `return Object.getOwnPropertySymbols(k).length;`,
  "Reflect.ownKeys": `return Reflect.ownKeys(k).filter(name => name !== "stack" && name !== "line" && name !== "column" && name !== "sourceURL").map(String).join();`,
  "Object.getOwnPropertyDescriptor": `return JSON.stringify(Object.getOwnPropertyDescriptor(k, "count")) + JSON.stringify(Object.getOwnPropertyDescriptor(k, "twice")) + JSON.stringify(Object.getOwnPropertyDescriptor(k, "note"));`,
  "Object.getOwnPropertyDescriptors": `const all = Object.getOwnPropertyDescriptors(k) as any; return JSON.stringify(all.count) + JSON.stringify(all.label);`,
  "delete of the optional field": `return delete k.note;`,
  "delete of a field": `return delete (k as any).count;`,
  "delete of a field, then a store": `delete (k as any).count; k.count = 8; return Object.keys(k).join();`,
  "delete of every field": `delete (k as any).count; delete (k as any).label; delete k.note; return Object.keys(k).join();`,
  "delete of a name it has not": `return delete (k as any).absent;`,
  "delete of the method's name": `return delete (k as any).twice;`,
  "Reflect.deleteProperty": `return Reflect.deleteProperty(k, "count");`,
  "a store to a field": `k.count = 5; return k.count;`,
  "a store of a text to a field": `(k as any).count = "s"; return typeof k.count;`,
  "a store to the optional field": `k.note = "n"; return k.note;`,
  "a store of undefined to the optional field": `k.note = undefined; return "note" in k;`,
  "a store to the field that is left out": `k.late = "l"; return Object.keys(k).join();`,
  "a store to a new name": `(k as any).fresh = 1; return Object.keys(k).join();`,
  "many stores to new names": `for (let i = 0; i < 40; i++) (k as any)["fresh" + i] = i; return Object.keys(k).length;`,
  "a field goes up": `k.count++; k.count += 2; return k.count;`,
  "a store through the accessor": `k.half = 4; return k.count;`,
  "a store to the method's name": `(k as any).twice = () => 79; return k.twice();`,
  "a store under a name that comes late": `(k as any)[nameOfCount()] = "s"; return typeof k.count;`,
  "a read under a name that comes late": `return String((k as any)[nameOfCount()]);`,
  "a store under an index": `try { (k as any)[0] = 5; return String((k as any)[0]); } catch (e) { return (e as Error).name; }`,
  "a store under a large index": `try { (k as any)[100000] = 5; return String((k as any)[100000]); } catch (e) { return (e as Error).name; }`,
  "a store under a symbol": `(k as any)[Symbol.for("s")] = 5; return Object.getOwnPropertySymbols(k).length;`,
  "Reflect.set": `return Reflect.set(k, "count", "s");`,
  "Reflect.set with another receiver": `return Reflect.set(k, "count", 4, other) + ":" + other.count;`,
  "Reflect.get": `return Reflect.get(k, "count") + ":" + Reflect.get(k, "half", other);`,
  "in": `return ["count" in k, "note" in k, "late" in k, "twice" in k, "half" in k, "absent" in k, "toString" in k].join();`,
  "Reflect.has": `return [Reflect.has(k, "count"), Reflect.has(k, "late"), Reflect.has(k, "twice")].join();`,
  "Object.hasOwn": `return [Object.hasOwn(k, "count"), Object.hasOwn(k, "note"), Object.hasOwn(k, "late"), Object.hasOwn(k, "twice"), Object.hasOwn(k, "absent")].join();`,
  "hasOwnProperty": `return [k.hasOwnProperty("count"), k.hasOwnProperty("late"), k.hasOwnProperty("twice")].join();`,
  "propertyIsEnumerable": `return [k.propertyIsEnumerable("count"), k.propertyIsEnumerable("twice")].join();`,
  "compared": `return [k === other, k !== other, k == other, Object.is(k, k), Object.is(k, other)].join();`,
  "typeof": `return typeof k;`,
  "truthiness": `return truthiness(k) + truthiness(undefined);`,
  "instanceof": `return [k instanceof Kept, k instanceof Below, k instanceof Stranger, k instanceof Object, (k as any) instanceof Map, (k as any) instanceof Error].join();`,
  "isPrototypeOf": `return [Kept.prototype.isPrototypeOf(k), Object.prototype.isPrototypeOf(k), Stranger.prototype.isPrototypeOf(k)].join();`,
  "the constructor is read": `return k.constructor === Kept;`,
  "Object.prototype.toString": `return Object.prototype.toString.call(k);`,
  "made a text": `try { return typeof String(k) + typeof (k + "") + typeof \`\${k}\`; } catch (e) { return (e as Error).name; }`,
  "made a number": `try { return typeof +(k as any); } catch (e) { return (e as Error).name; }`,
  "valueOf": `return typeof k.valueOf();`,
  "Symbol.toPrimitive on the object": `(k as any)[Symbol.toPrimitive] = function (this: Kept) { return this.count; }; return \`\${k as any}\`;`,
  "Symbol.toStringTag on the object": `(k as any)[Symbol.toStringTag] = "Tagged"; return Object.prototype.toString.call(k);`,
  "the method taken off": `const twice = k.twice; return twice.call(k) + ":" + twice.call(other);`,
  "the method bound": `return k.twice.bind(other)();`,
  "the method through the prototype object": `return Kept.prototype.twice.call(k);`,
  "the method applied": `return Reflect.apply(k.twice, k, []) + k.twice.apply(other);`,
  "the method for a stranger": `try { return String(k.twice.call({ count: 50 } as any)); } catch (e) { return (e as Error).name; }`,
  "the method replaced on the class": `(Kept.prototype as any).twice = function (this: Kept) { return this.count * 20; }; return k.twice();`,
  "the method deleted from the class": `delete (Kept.prototype as any).twice; try { return String(k.twice()); } catch (e) { return (e as Error).name; }`,
  "the accessor replaced on the class": `Object.defineProperty(Kept.prototype, "half", { get() { return 72; }, configurable: true }); return k.half;`,
  "a field's name defined on the class": `Object.defineProperty(Kept.prototype, "late", { get() { return "from above"; }, set(v) { print("setter " + v); }, configurable: true }); k.late = "l"; return String(k.late);`,
  "another parent for the prototype object": `Object.setPrototypeOf(Kept.prototype, Stranger.prototype); try { return String(k.twice()) + (k instanceof Stranger); } catch (e) { return (e as Error).name; }`,
  "Symbol.hasInstance on the class": `Object.defineProperty(Kept, Symbol.hasInstance, { value: () => false }); return k instanceof Kept;`,
  "a key of a Map, an element of a Set": `const map = new Map<Kept, number>([[k, 1], [other, 2]]); const set = new Set<Kept>([k]); return map.get(k) + ":" + map.get(other) + ":" + set.has(k) + ":" + set.has(other);`,
  "a key of a WeakMap, held by a WeakRef": `const map = new WeakMap<Kept, number>([[k, 1]]); return map.get(k) + ":" + map.has(other) + ":" + (new WeakRef(k).deref() === k);`,
  "looked for in an array": `const list: Kept[] = [other, k]; return list.indexOf(k) + ":" + list.includes(other) + ":" + list.lastIndexOf(k) + ":" + list.findIndex(each => each === k);`,
  "sorted in an array": `other.count = 0; const list: Kept[] = [k, other]; list.sort((a, b) => a.count - b.count); return list[0] === other;`,
  "awaited": `return awaitedLater(k);`,
  "thrown and caught": `try { throw k; } catch (e) { return e === k && e instanceof Kept ? (e as Kept).twice() : -1; }`,
  "Error.captureStackTrace": `(Error as any).captureStackTrace(k); return typeof (k as any).stack;`,
  "inspected": `return typeof Bun.inspect(k);`,
  "Bun.deepEquals": `return Bun.deepEquals(k, other) + ":" + Bun.deepEquals(k, k);`,
  "handed to untyped code that changes it": `changeOutOfSight(k); return typeof k.count + ":" + k.twice();`,
  "a proxy of it": `const proxy = new Proxy(k, { get: (target, name, receiver) => (name === "count" ? 60 : Reflect.get(target, name, target)) }); try { return describe(proxy); } catch (e) { return (e as Error).name; }`,
  "an object below it": `const below: Kept = Object.create(k); try { return describe(below); } catch (e) { return (e as Error).name; }`,
  "an instance of the class below": `return describe(new Below());`,
  "an object with the prototype and nothing else": `try { return describe(Object.create(Kept.prototype)); } catch (e) { return (e as Error).name; }`,
  "an instance of the parent with the prototype": `try { return describe(Object.setPrototypeOf(parentMade(), Kept.prototype)); } catch (e) { return (e as Error).name; }`,
  "the parent constructed for the class": `try { return describe(Reflect.construct(Object.getPrototypeOf(Kept), parentOperands(), Kept)); } catch (e) { return (e as Error).name; }`,
  "the class constructed for the parent": `try { return describe(Reflect.construct(Kept, [], Object.getPrototypeOf(Kept))); } catch (e) { return (e as Error).name; }`,
  "the class constructed for a stranger": `try { return describe(Reflect.construct(Kept, [], Stranger)); } catch (e) { return (e as Error).name; }`,
  "the class constructed for the class below": `try { return describe(Reflect.construct(Kept, [], Below)); } catch (e) { return (e as Error).name; }`,
  "a literal with its names": `try { return describe({ count: 1, label: "l", twice() { return 3; }, half: 4 } as any); } catch (e) { return (e as Error).name; }`,
  "the built-in part changes": `changeBuiltinPart(k); return holds(k);`,
  "nothing": `return 0;`,
};

export function textOf(base: string, operation: string) {
  const { heritage, operands, holds, changes, before } = bases[base];
  return `${before ?? ""}
const lines: string[] = [];
function print(line: string) { lines.push(line); }
class Kept extends ${heritage} {
  count: number = 1;
  label: string = "l";
  note?: string;
  declare late?: string;
  constructor() { super(${operands}); }
  twice(): number { return this.count * 2; }
  get half(): number { return this.count / 2; }
  set half(value: number) { this.count = value * 2; }
}
class Below extends Kept {
  more: number = 2;
  twice(): number { return this.count * 3 + this.more; }
}
class Stranger { twice(): number { return 90; } get half(): number { return 91; } }
function parentOperands(): any[] { return [${operands}]; }
function parentMade(): any { return Reflect.construct(Object.getPrototypeOf(Kept), parentOperands()); }
function nameOfCount(): string { return ["co", "unt"].join(""); }
function holds(k: Kept): string { try { return ${holds}; } catch (e) { return "throws " + (e as Error).name; } }
function changeBuiltinPart(k: Kept) { try { ${changes ?? ""} } catch (e) { print("throws " + (e as Error).name); } }
function truthiness(k: Kept | undefined): number { return (k ? 1 : 0) + (!k ? 2 : 0) + (k && 4 ? 4 : 0); }
function attempt(read: () => unknown): string { try { const value = read(); return typeof value + " " + String(value); } catch (e) { return "throws " + (e as Error).name; } }
function describe(k: Kept): string {
  return [attempt(() => k.count), attempt(() => k.label), attempt(() => k.note), attempt(() => k.late), attempt(() => k.twice()), attempt(() => k.half), attempt(() => k instanceof Kept), attempt(() => "count" in k), holds(k)].join(" | ");
}
function store(k: Kept, value: number): string { try { k.count = value; k.half = value; k.note = "n" + value; return "stored " + String(k.count); } catch (e) { return "throws " + (e as Error).name; } }
const listOutOfSight = new Function("k", \`
  const hidden = new Set(["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"]);
  const parts = [];
  for (const name of Reflect.ownKeys(k)) {
    if (hidden.has(name)) continue;
    const d = Reflect.getOwnPropertyDescriptor(k, name);
    parts.push(String(name) + "=" + ("value" in d ? typeof d.value + " " + (typeof d.value === "object" || typeof d.value === "function" ? "" : String(d.value)) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""));
  }
  return parts.join(",") + " " + Object.isExtensible(k) + Object.isSealed(k) + Object.isFrozen(k);
\`) as (k: unknown) => string;
const changeOutOfSight = new Function("k", \`k.count = "out of sight"; k.twice = function () { return "replaced"; };\`) as (k: unknown) => void;
const later: Promise<unknown>[] = [];
function awaitedLater(k: Kept): string { later.push((async () => { const value = await k; print("awaited " + (value === (k as unknown)) + " " + typeof value); })()); return "later"; }
function operate(k: Kept, other: Kept): unknown { ${operations[operation]} }
function look(title: string, k: Kept) { print(title + ": " + describe(k) + " || " + attempt(() => listOutOfSight(k))); }

const k = new Kept();
const other = new Kept();
look("before", k);
print("result: " + attempt(() => operate(k, other)));
look("after", k);
look("the other", other);
Bun.gc(true);
const filler: unknown[] = [];
for (let i = 0; i < 2000; i++) filler.push({ i }, [i], "t" + i);
Bun.gc(true);
look("behind a collection", k);
print("store: " + store(k, 21));
look("behind a store", k);
changeBuiltinPart(k);
look("behind a change of the built-in part", k);
try {
  for (let i = 0; i < 3; i++) {
    const fresh = new Kept();
    look("fresh", fresh);
    print("result: " + attempt(() => operate(fresh, new Below())));
    print("store: " + store(fresh, i));
    look("fresh after", fresh);
  }
  look("below", new Below());
} catch (e) {
  print("throws " + (e as Error).name);
}
Bun.gc(true);
look("at the end", k);
await Promise.all(later);
print(String(filler.length));
console.log(lines.join("\\n"));
export {};
`;
}
