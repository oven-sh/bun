// A function that declares a Buffer or a Uint8Array reads `length`, elements and the methods of node:buffer without a lookup by name, behind a test of what it was given. What it is given may be anything:
// a Buffer where a Uint8Array is declared, a Uint8Array where a Buffer is declared, an instance of a class below either, one with a `length` of its own or below another prototype, one of another realm,
// one whose memory was detached, shrank or grew, something that holds no bytes at all. And it may become any of these in the middle of a loop.
//
// Every case is a declared type and an operation, in a function of its own:
//   type       what the parameter declares
//   operation  what the function does with it
// Each function is called with a fresh value from every maker, between calls with a plain Buffer and a plain Uint8Array. What is printed is compared with plain Bun.
import { join } from "path";
import { spread } from "./case-files";
export { ways } from "./objects-born-in-every-place";

const bytes = "[1, 2, 3, 250, 5, 6, 7, 8]";

// prettier-ignore
const makers: Record<string, string> = {
  "a Buffer": `Buffer.from(${bytes})`,
  "a Buffer of text": `Buffer.from("abcdefgh")`,
  "a Buffer that was allocated": `Buffer.alloc(8, 3)`,
  "a Buffer over a part of its memory": `Buffer.from(new Uint8Array([9, 9, 9, 9, 1, 2, 3, 250, 5, 6, 7, 8, 9, 9, 9, 9]).buffer, 4, 8)`,
  "a part of a Buffer": `Buffer.from([0, 0, 1, 2, 3, 250, 5, 6, 7, 8]).subarray(2)`,
  "an empty Buffer": `Buffer.alloc(0)`,
  "a long Buffer": `Buffer.alloc(300, 7)`,
  "a Uint8Array": `new Uint8Array(${bytes})`,
  "a part of a Uint8Array": `new Uint8Array([0, 0, 1, 2, 3, 250, 5, 6, 7, 8]).subarray(2)`,
  "an empty Uint8Array": `new Uint8Array(0)`,
  "of a class below Buffer": `new (BelowBuffer as any)(${bytes})`,
  "of a class below Buffer, by its prototype": `Object.setPrototypeOf(Buffer.from(${bytes}), BelowBuffer.prototype)`,
  "of a class below Buffer with a length": `Object.setPrototypeOf(Buffer.from(${bytes}), BufferWithLength.prototype)`,
  "of a class below Buffer with methods": `Object.setPrototypeOf(Buffer.from(${bytes}), BufferWithMethods.prototype)`,
  "of a class below Uint8Array": `new BelowView(${bytes})`,
  "of a class below Uint8Array with a length": `new ViewWithLength(${bytes})`,
  "of a class below Uint8Array with methods": `new ViewWithMethods(${bytes})`,
  "a Buffer with a length of its own": `Object.defineProperty(Buffer.from(${bytes}), "length", { value: 2, configurable: true })`,
  "a Buffer with a getter for length": `Object.defineProperty(Buffer.from(${bytes}), "length", { get() { return 3; }, configurable: true })`,
  "a Buffer with a byteLength of its own": `Object.defineProperty(Buffer.from(${bytes}), "byteLength", { value: 1 })`,
  "a Buffer with another property": `Object.assign(Buffer.from(${bytes}), { tag: 1 })`,
  "a Buffer with methods of its own": `Object.assign(Buffer.from(${bytes}), { readUInt8() { return -1; }, readUInt32LE() { return -2; }, writeUInt32LE() { return -3; }, slice() { return "own"; }, at() { return -4; } })`,
  "a Buffer with an iterator of its own": `Object.assign(Buffer.from(${bytes}), { *[Symbol.iterator]() { yield 42; } })`,
  "a Uint8Array with a length of its own": `Object.defineProperty(new Uint8Array(${bytes}), "length", { value: 2 })`,
  "a Uint8Array with another property": `Object.assign(new Uint8Array(${bytes}), { tag: 1 })`,
  "a Buffer below Uint8Array.prototype": `Object.setPrototypeOf(Buffer.from(${bytes}), Uint8Array.prototype)`,
  "a Uint8Array below Buffer.prototype": `Object.setPrototypeOf(new Uint8Array(${bytes}), Buffer.prototype)`,
  "a Buffer below nothing": `Object.setPrototypeOf(Buffer.from(${bytes}), null)`,
  "a Buffer below Object.prototype": `Object.setPrototypeOf(Buffer.from(${bytes}), Object.prototype)`,
  "a Buffer below Array.prototype": `Object.setPrototypeOf(Buffer.from(${bytes}), Array.prototype)`,
  "a Buffer below an object with a length": `Object.setPrototypeOf(Buffer.from(${bytes}), Object.create(Buffer.prototype, { length: { get() { return 1; } } }))`,
  "a Buffer below an empty object": `Object.setPrototypeOf(Buffer.from(${bytes}), Object.create(Buffer.prototype))`,
  "a Buffer below a Proxy": `Object.setPrototypeOf(Buffer.from(${bytes}), new Proxy(Buffer.prototype, { get(target, key, receiver) { return key === "length" ? 4 : Reflect.get(target, key, receiver); } }))`,
  "a Uint8Array below an object with a length": `Object.setPrototypeOf(new Uint8Array(${bytes}), Object.create(Uint8Array.prototype, { length: { get() { return 1; } } }))`,
  "a Buffer that takes no more properties": `Object.preventExtensions(Buffer.from(${bytes}))`,
  "a Uint8Array that takes no more properties": `Object.preventExtensions(new Uint8Array(${bytes}))`,
  "a Uint8Array of another realm": `runInNewContext("new Uint8Array(${bytes})")`,
  "a Uint8Array of another realm below Buffer.prototype": `Object.setPrototypeOf(runInNewContext("new Uint8Array(${bytes})"), Buffer.prototype)`,
  "a Buffer below the Uint8Array.prototype of another realm": `Object.setPrototypeOf(Buffer.from(${bytes}), runInNewContext("Uint8Array.prototype"))`,
  "a Buffer made by the code of another realm": `runInNewContext("make(${bytes})", { make: (list: number[]) => Buffer.from(list) })`,
  "a Buffer over the memory of another realm": `Buffer.from(runInNewContext("new Uint8Array(${bytes}).buffer"))`,
  "a detached Buffer": `detached(Buffer.from(new Uint8Array(${bytes}).buffer))`,
  "a detached Uint8Array": `detached(new Uint8Array(${bytes}))`,
  "a Buffer over memory that can be resized": `Buffer.from(resizable(8, 8))`,
  "a Buffer whose memory shrank": `resized(Buffer.from(resizable(8, 8)), 4)`,
  "a Buffer whose memory grew": `resized(Buffer.from(resizable(8, 8)), 12)`,
  "a Buffer of a fixed length whose memory shrank": `resized(Buffer.from(resizable(8, 8), 0, 6), 4)`,
  "a Buffer behind the start whose memory shrank": `resized(Buffer.from(resizable(8, 8), 2), 5)`,
  "a Buffer behind the start whose memory ends ahead of it": `resized(Buffer.from(resizable(8, 8), 4), 2)`,
  "a Uint8Array that follows its memory": `new Uint8Array(resizable(8, 8))`,
  "a Uint8Array whose memory shrank": `resized(new Uint8Array(resizable(8, 8)), 4)`,
  "a Uint8Array whose memory grew": `resized(new Uint8Array(resizable(8, 8)), 12)`,
  "a Uint8Array of a fixed length whose memory shrank": `resized(new Uint8Array(resizable(8, 8), 0, 6), 4)`,
  "a Uint8Array of a fixed length whose memory came back": `resized(resized(new Uint8Array(resizable(8, 8), 0, 6), 4), 8)`,
  "a Buffer over shared memory": `filled(Buffer.from(new SharedArrayBuffer(8)))`,
  "a Uint8Array over shared memory": `filled(new Uint8Array(new SharedArrayBuffer(8)))`,
  "a Buffer over shared memory that grew": `grown(filled(Buffer.from(new SharedArrayBuffer(8, { maxByteLength: 16 }))), 12)`,
  "a Uint8Array over shared memory that grew": `grown(filled(new Uint8Array(new SharedArrayBuffer(8, { maxByteLength: 16 }))), 12)`,
  "an Int8Array": `new Int8Array(${bytes})`,
  "a Uint8ClampedArray": `new Uint8ClampedArray(${bytes})`,
  "a Uint16Array": `new Uint16Array(${bytes})`,
  "a Float64Array": `new Float64Array(${bytes})`,
  "a BigInt64Array": `new BigInt64Array(2)`,
  "a DataView": `new DataView(new Uint8Array(${bytes}).buffer)`,
  "an ArrayBuffer": `new Uint8Array(${bytes}).buffer`,
  "an array": bytes,
  "an array with a hole": `[1, , 3]`,
  "a string": `"abcdefgh"`,
  "an object with a length": `{ length: 3, 0: 4, 1: 5, 2: 6 }`,
  "an object with the methods": `{ length: 2, 0: 4, 1: 5, readUInt8: () => "read", readUInt32LE: () => "read", writeUInt32LE: () => "written", slice: () => [1], toString: () => "text" }`,
  "a Proxy of a Buffer": `new Proxy(Buffer.from(${bytes}), {})`,
  "a function": `Object.assign(function three(a: number, b: number, c: number) { return a + b + c; }, { toString() { return "three"; } })`,
  "a number": `8`,
  "null": `null`,
  "undefined": `undefined`,
};

const types: Record<string, string> = {
  "Buffer": "Buffer",
  "Uint8Array": "Uint8Array",
  "any": "any",
  "BufferOrNull": "Buffer | null",
  "Either": "Uint8Array | Buffer",
  "BufferOrText": "Buffer | string",
  "Indexed": "ArrayLike<number>",
};

const sum = (change: string) => `let s = 0; for (let i = 0; i < b.length; i++) { s += b[i]; if (i === 1) ${change}; } return [s, b.length, b[0]];`;

// prettier-ignore
const operations: Record<string, string> = {
  "length": `return b.length;`,
  "byteLength": `return b.byteLength;`,
  "byteOffset": `return b.byteOffset;`,
  "all-three": `return [b.length, b.byteLength, b.byteOffset];`,
  "memory": `return b.buffer.byteLength;`,
  "length-twice": `const first = b.length; see(b); return [first, b.length];`,
  "first": `return b[0];`,
  "last": `return b[b.length - 1];`,
  "behind-the-end": `return b[b.length];`,
  "far": `return b[100];`,
  "ahead-of-the-start": `return b[-1];`,
  "at-a-fraction": `return b[1.5];`,
  "at-text": `return b["1"];`,
  "at-given": `return [b[index(0)], b[index(7)], b[index(8)], b[index(-1)]];`,
  "sum": `let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s;`,
  "sum-of-integers": `let s = 0; for (let i = 0; i < b.length; i++) s = (s + b[i]) | 0; return s;`,
  "sum-with-kept-length": `let s = 0; const n = b.length; for (let i = 0; i < n; i++) s += b[i]; return s;`,
  "sum-backwards": `let s = 0; for (let i = b.length - 1; i >= 0; i--) s += b[i]; return s;`,
  "sum-of-values": `let s = 0; for (const v of b) s += v; return s;`,
  "sum-by-twos": `let s = 0; for (let i = 0; i + 1 < b.length; i += 2) s += b[i] * 256 + b[i + 1]; return s;`,
  "sum-twice": `let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; for (let i = 0; i < b.length; i++) s += b[i]; return s;`,
  "find": `for (let i = 0; i < b.length; i++) if (b[i] === 250) return i; return -1;`,
  "count-while": `let i = 0; while (i < b.length && b[i] !== 5) i++; return i;`,
  "fill-by-index": `for (let i = 0; i < b.length; i++) b[i] = i * 3; return list(b);`,
  "store": `b[1] = 77; return list(b);`,
  "store-wide": `b[1] = 300; b[2] = -1; b[3] = 1.7; return list(b);`,
  "store-behind-the-end": `b[b.length] = 7; return [b.length, b[b.length - 1]];`,
  "store-far": `b[100] = 7; return [b.length, b[100]];`,
  "add-in-place": `for (let i = 0; i < b.length; i++) b[i] += 1; return list(b);`,
  "sum-while-it-shrinks": sum("shrink(b)"),
  "sum-while-it-grows": sum("grow(b)"),
  "sum-while-it-is-detached": sum("detach(b)"),
  "sum-while-it-gets-a-length": sum(`Object.defineProperty(b, "length", { value: 4, configurable: true })`),
  "sum-while-it-gets-a-property": sum("tag(b)"),
  "sum-while-its-prototype-changes": sum("Object.setPrototypeOf(b, WithLength)"),
  "sum-while-it-goes-below-Uint8Array": sum("Object.setPrototypeOf(b, Uint8Array.prototype)"),
  "reads-while-its-prototype-changes": `const first = b.readUInt8(0); Object.setPrototypeOf(b, WithMethods); return [first, b.readUInt8(0), b.length];`,
  "reads-while-it-gets-a-method": `const first = b.readUInt8(0); b.readUInt8 = () => -9; return [first, b.readUInt8(0)];`,
  "reads-while-it-is-detached": `const first = b.readUInt32LE(0); detach(b); return [first, b.length, b.readUInt32LE(0)];`,
  "reads-while-it-shrinks": `const first = b.readUInt32LE(4); shrink(b); return [first, b.length, b.readUInt32LE(4)];`,
  "readUInt8": `return b.readUInt8(1);`,
  "readUInt8-of-nothing": `return b.readUInt8();`,
  "readUInt8-behind-the-end": `return b.readUInt8(b.length);`,
  "readUInt8-ahead-of-the-start": `return b.readUInt8(-1);`,
  "readInt8": `return b.readInt8(3);`,
  "readUInt16BE": `return b.readUInt16BE(1);`,
  "readUInt16LE": `return b.readUInt16LE(2);`,
  "readInt16BE": `return b.readInt16BE(3);`,
  "readInt16LE": `return b.readInt16LE(2);`,
  "readUInt32LE": `return b.readUInt32LE(0);`,
  "readUInt32BE": `return b.readUInt32BE(3);`,
  "readInt32LE": `return b.readInt32LE(0);`,
  "readInt32BE": `return b.readInt32BE(3);`,
  "readUInt32LE-at-the-last-place": `return b.readUInt32LE(b.length - 4);`,
  "readUInt32LE-across-the-end": `return b.readUInt32LE(5);`,
  "readUInt32LE-at-a-fraction": `return b.readUInt32LE(1.5);`,
  "readUInt32LE-at-no-number": `return b.readUInt32LE(NaN);`,
  "readUInt32LE-at-text": `return b.readUInt32LE(text("1"));`,
  "readUInt32LE-at-given": `return [b.readUInt32LE(index(0)), b.readUInt32LE(index(4))];`,
  "readUint32LE": `return b.readUint32LE(1);`,
  "readFloatLE": `return b.readFloatLE(0);`,
  "readDoubleBE": `return b.readDoubleBE(0);`,
  "readBigUInt64LE": `return b.readBigUInt64LE(0);`,
  "readUIntBE": `return b.readUIntBE(1, 3);`,
  "words": `let s = 0; for (let i = 0; i + 4 <= b.length; i += 4) s = (s + b.readUInt32LE(i)) | 0; return s;`,
  "shorts": `let s = 0; for (let i = 0; i + 2 <= b.length; i += 2) s = (s + b.readUInt16BE(i)) | 0; return s;`,
  "bytes": `let s = 0; for (let i = 0; i < b.length; i++) s = (s + b.readUInt8(i)) | 0; return s;`,
  "words-one-too-many": `let s = 0; for (let i = 0; i <= b.length; i += 4) s = (s + b.readUInt32LE(i)) | 0; return s;`,
  "writeUInt8": `return [b.writeUInt8(200, 1), list(b)];`,
  "writeUInt8-too-large": `return [b.writeUInt8(256, 1), list(b)];`,
  "writeInt8": `return [b.writeInt8(-2, 1), list(b)];`,
  "writeUInt16BE": `return [b.writeUInt16BE(0xabcd, 1), list(b)];`,
  "writeUInt16LE": `return [b.writeUInt16LE(0xabcd, 6), list(b)];`,
  "writeUInt32LE": `return [b.writeUInt32LE(0xdeadbeef, 2), list(b)];`,
  "writeUInt32BE": `return [b.writeUInt32BE(0xdeadbeef, 4), list(b)];`,
  "writeInt32LE": `return [b.writeInt32LE(-2, 0), list(b)];`,
  "writeUInt32LE-of-nothing": `return [b.writeUInt32LE(7), list(b)];`,
  "writeUInt32LE-across-the-end": `return [b.writeUInt32LE(1, 5), list(b)];`,
  "writeUInt32LE-too-large": `return [b.writeUInt32LE(2 ** 32, 0), list(b)];`,
  "writeUInt32LE-negative": `return [b.writeUInt32LE(-1, 0), list(b)];`,
  "writeUInt32LE-a-fraction": `return [b.writeUInt32LE(1.7, 0), list(b)];`,
  "writeUInt32LE-text": `return [b.writeUInt32LE(text("5"), 0), list(b)];`,
  "writeDoubleLE": `return [b.writeDoubleLE(1.5, 0), list(b)];`,
  "write-words": `for (let i = 0; i + 4 <= b.length; i += 4) b.writeUInt32LE(i + 1, i); return list(b);`,
  "write-text": `return [b.write("hi", 1), list(b)];`,
  "slice-shares": `const s = b.slice(1, 3); s[0] = 99; return [list(s), list(b), nameOf(s)];`,
  "subarray-shares": `const s = b.subarray(1, 3); s[0] = 99; return [list(s), list(b), nameOf(s)];`,
  "slice-then-length": `return b.slice(2).length;`,
  "subarray-then-read": `return b.subarray(2).readUInt16BE(0);`,
  "toString": `return b.toString();`,
  "toString-hex": `return b.toString("hex");`,
  "toString-base64": `return b.toString("base64", 1, 5);`,
  "toString-latin1": `return b.toString("latin1");`,
  "as-text": `return String(b) + \`\${b}\`;`,
  "toJSON": `return JSON.stringify(b);`,
  "fill": `return list(b.fill(7));`,
  "fill-a-part": `return list(b.fill(9, 2, 4));`,
  "fill-with-text": `return list(b.fill("ab"));`,
  "indexOf": `return [b.indexOf(250), b.indexOf(99), b.indexOf(3, 4)];`,
  "indexOf-text": `return b.indexOf("cd");`,
  "includes": `return [b.includes(250), b.includes(99)];`,
  "lastIndexOf": `return b.lastIndexOf(5);`,
  "equals": `return [b.equals(Buffer.from(${bytes})), b.equals(new Uint8Array(2))];`,
  "compare": `return b.compare(Buffer.from([1, 2, 4]));`,
  "copy": `const target = Buffer.alloc(4); return [b.copy(target, 1, 2), list(target)];`,
  "swap16": `return list(b.swap16());`,
  "at": `return [b.at(-1), b.at(0), b.at(100)];`,
  "set": `b.set([9, 9], 1); return list(b);`,
  "join": `return b.join("-");`,
  "map": `const m = b.map((v: number) => v + 1); return [list(m), nameOf(m), m.length];`,
  "map-then-slice": `const m = b.map((v: number) => v + 1); const s = m.slice(0, 2); s[0] = 0; return [list(m), nameOf(s)];`,
  "filter": `const f = b.filter((v: number) => v > 3); return [list(f), nameOf(f)];`,
  "reverse": `return list(b.reverse());`,
  "sort": `return list(b.sort());`,
  "toSorted": `const s = b.toSorted(); return [list(s), nameOf(s)];`,
  "with": `const w = b.with(0, 9); return [list(w), nameOf(w)];`,
  "reduce": `return b.reduce((a: number, v: number) => a + v, 0);`,
  "every-some-find": `return [b.every((v: number) => v > 0), b.some((v: number) => v > 200), b.find((v: number) => v > 4), b.findIndex((v: number) => v > 4), b.findLast((v: number) => v < 4)];`,
  "forEach": `let s = 0; b.forEach((v: number, i: number) => { s += v * i; }); return s;`,
  "keys": `return [...b.keys()];`,
  "entries": `return [...b.entries()];`,
  "values": `return [...b.values()];`,
  "spread": `return [...b];`,
  "destructure": `const [first, second, ...rest] = b; return [first, second, rest];`,
  "Array.from": `return Array.from(b);`,
  "own-keys": `return Object.keys(b);`,
  "for-in": `const keys = []; for (const key in b) keys.push(key); return keys.slice(0, 12);`,
  "has": `return ["length" in b, 0 in b, 8 in b, "readUInt8" in b];`,
  "has-its-own": `return [Object.hasOwn(b, "length"), Object.hasOwn(b, 0), Object.hasOwn(b, "tag")];`,
  "constructor": `return nameOf(b);`,
  "instanceof": `return [b instanceof Buffer, b instanceof Uint8Array, b instanceof Object];`,
  "predicates": `return [Buffer.isBuffer(b), ArrayBuffer.isView(b), Array.isArray(b), typeof b];`,
  "class-text": `return Object.prototype.toString.call(b);`,
  "prototype": `const p = Object.getPrototypeOf(b); return [p === Buffer.prototype, p === Uint8Array.prototype];`,
  "Buffer.byteLength": `return Buffer.byteLength(b);`,
  "Buffer.concat": `const c = Buffer.concat([b, b]); return [c.length, list(c)];`,
  "Buffer.from": `const c = Buffer.from(b); c[0] = 77; return [list(c), list(b)];`,
  "Buffer.compare": `return Buffer.compare(b, Buffer.from([1, 2, 4]));`,
  "new-Uint8Array": `const c = new Uint8Array(b); return [c.length, list(c)];`,
  "decode": `return new TextDecoder().decode(b);`,
  "length-or-nothing": `return b?.length;`,
  "length-if-any": `return b ? b.length : "none";`,
  "length-if-a-Buffer": `return Buffer.isBuffer(b) ? b.length : "no Buffer";`,
  "length-if-an-instance": `return b instanceof Uint8Array ? [b.length, b[0]] : "no view";`,
  "length-if-no-text": `return typeof b === "string" ? "text " + b.length : b.length;`,
  "handed-on": `return lengthOf(b) + lengthOfView(b) + lengthOfAny(b);`,
  "kept-in-an-object": `const holder = { bytes: b, at: 1 }; see(holder); return [holder.bytes.length, holder.bytes[holder.at]];`,
  "from-a-closure": `const read = () => b.length + b[0]; see(read); return read();`,
  "assign-length": `b.length = 2; return b.length;`,
  "delete-length": `return [delete b.length, b.length];`,
};

export const everyCase = Object.keys(types).flatMap(type => Object.keys(operations).map(operation => `${type} ${operation}`));
export const sample = (count: number) => spread(everyCase, count);
// A number that is stored into a BigInt64Array throws a TypeError wherever the index lies: the value is converted before the index is tested.
export const written = Object.fromEntries(Object.keys(types).flatMap(type => ["store-behind-the-end", "store-far"].map(operation => [`${type} ${operation} | a BigInt64Array | `, "threw TypeError"])));

const head = (isOpened: boolean) => `import { runInNewContext } from "node:vm";
const seen = ${isOpened ? 'new Function("value", "return value" + String(process.argv.length).slice(9)) as <V>(value: V) => V' : "<V>(value: V): V => value"};
let SEEN = 0;
function see(value: unknown): void { if (value !== null && value !== undefined) SEEN++; }
const INDEXES: number[] = seen([0, 1, 2, 3, 4, 5, 6, 7, 8]);
function index(i: number): number { return i < 0 ? i : INDEXES[i]; }
function text(value: string): any { return seen(value); }
class BelowBuffer extends (Buffer as any) {}
class BufferWithLength extends (Buffer as any) { get length() { return 3; } }
class BufferWithMethods extends (Buffer as any) { readUInt8() { return -1; } readUInt16BE() { return -2; } readUInt32LE() { return -3; } writeUInt32LE() { return -4; } slice() { return [5]; } subarray() { return [6]; } toString() { return "mine"; } fill() { return [7]; } at() { return -8; } }
class BelowView extends Uint8Array {}
class ViewWithLength extends Uint8Array { get length() { return 3; } get byteLength() { return 30; } }
class ViewWithMethods extends Uint8Array { at() { return -1; } fill(): any { return [2]; } slice(): any { return [3]; } subarray(): any { return [4]; } join() { return "joined"; } *[Symbol.iterator](): any { yield 11; yield 12; } static get [Symbol.species]() { return Uint8Array; } }
const WithLength = Object.create(Buffer.prototype, { length: { get() { return 5; } } });
const WithMethods = Object.create(Buffer.prototype, { readUInt8: { value() { return -7; } }, length: { get() { return 6; } } });
function resizable(length: number, filledTo: number): ArrayBuffer { const memory = new ArrayBuffer(length, { maxByteLength: 16 }); const view = new Uint8Array(memory); for (let i = 0; i < filledTo; i++) view[i] = ${bytes}[i]; return memory; }
function resized<V extends ArrayBufferView>(view: V, length: number): V { (view.buffer as ArrayBuffer).resize(length); return view; }
function grown<V extends ArrayBufferView>(view: V, length: number): V { (view.buffer as any).grow(length); return view; }
function filled<V extends Uint8Array>(view: V): V { for (let i = 0; i < view.length; i++) view[i] = ${bytes}[i]; return view; }
function detached<V extends ArrayBufferView>(view: V): V { (view.buffer as ArrayBuffer).transfer(); return view; }
function memoryOf(value: any): any { try { return Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), "buffer", value); } catch { return undefined; } }
function shrink(value: any): void { const memory = memoryOf(value); if (memory?.resizable) memory.resize(3); }
function grow(value: any): void { const memory = memoryOf(value); if (memory?.resizable) memory.resize(12); else if (memory?.growable) memory.grow(12); }
function detach(value: any): void { const memory = memoryOf(value); if (memory instanceof ArrayBuffer) memory.transfer(); }
function tag(value: any): void { value.tag = 2; }
function nameOf(value: any): string { return value?.constructor?.name ?? "none"; }
function list(value: any): string { try { return Array.prototype.join.call(value, ","); } catch (error) { return "no list"; } }
function lengthOf(b: Buffer): number { return b.length; }
function lengthOfView(b: Uint8Array): number { return b.length; }
function lengthOfAny(b: any): number { return b.length; }
function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) { let out = "["; for (let i = 0; i < value.length; i++) out += (i ? "," : "") + (i in value ? show(value[i]) : "_"); return out + "]"; }
  return nameOf(value) + "(" + list(value) + ")";
}
const MAKERS: [string, () => unknown][] = seen([
${Object.entries(makers)
  .map(([name, made]) => `  [${JSON.stringify(name)}, () => (${made})],`)
  .join("\n")}
]);
`;

const options = () =>
  JSON.stringify({
    compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: false, noEmit: true, skipLibCheck: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"] },
  });

export function program(cases: string[], isOpened = false): { file: string; text: string; files: Record<string, string> } {
  let text = head(isOpened);
  cases.forEach((name, n) => {
    const [type, operation] = name.split(" ");
    text += `// @ts-ignore\nfunction c${n}(b: ${types[type]}): unknown { ${operations[operation]} }\n`;
  });
  text += `const CASES: [string, (given: any) => unknown][] = [${cases.map((name, n) => `[${JSON.stringify(name)}, c${n}]`).join(", ")}];
function answer(run: (given: any) => unknown, make: () => unknown): string {
  let given: unknown;
  try { given = make(); } catch (error) { return "not made: " + (error as Error).name; }
  try { return show(run(given)); } catch (error: any) { return "threw " + error?.name + (error?.code ? " " + error.code + ": " + String(error.message).slice(0, 120) : ""); }
}
for (const [name, run] of CASES) {
  const plain = [answer(run, MAKERS[0][1]), answer(run, MAKERS[7][1])].join(" | ");
  console.log(name, "|", plain);
  for (const [receiver, make] of MAKERS) {
    console.log(name, "|", receiver, "|", answer(run, make));
    const again = [answer(run, MAKERS[0][1]), answer(run, MAKERS[7][1])].join(" | ");
    if (again !== plain) console.log(name, "| behind", receiver, "the plain ones answer", again);
  }
}
console.log(SEEN);
`;
  return { file: "main.ts", text, files: { "tsconfig.json": options() } };
}
