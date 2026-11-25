"use strict";

const holes = [1, 2, , 4, , 6], doubles = [0.5, 1.5, -0, NaN, 1e300, 2], texts = ["a", "bb", "", "7"], objects = [{ a: 1 }, null, undefined, [3], () => 1], mixedList = [1, "2", 3.5, null, true, undefined, { valueOf() { return 9; } }];
const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return 42; } });
const frozen = Object.freeze([5, 6, 7]), named = Object.assign([1, 2, 3], { length2: 4 }), long = Array.from({ length: 300 }, (_, i) => i * 3), longDoubles = long.map(x => x / 2), longTexts = long.map(x => "t" + x), large = [2147483647, 4294967296, -2147483648, 1];
const grown = []; grown[40] = 1; grown[3] = 2;
const sub = new (class Sub extends Array {})(); sub.push(1, 2, 3);
const own = new Uint8Array([1, 2, 3, 4]); Object.defineProperty(own, "length", { value: 2 });
const resizable = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 64 })); resizable.set([1, 2, 3]);
const detached = new Uint8Array(8); structuredClone(detached.buffer, { transfer: [detached.buffer] });
const proxied = new Proxy([1, 2, 3], {}), like = { length: 3, 0: 7, 1: 8, 2: 9 }, likeFew = { length: 5, 1: 3 };
const all = { ints: [3, 1, 2], empty: [], one: [7], holes, doubles, texts, objects, mixedList, getter, frozen, named, long, longDoubles, longTexts, large, grown, sub, own, resizable, detached, proxied, like, likeFew, u8: new Uint8Array([1, 2, 255]), buffer: Buffer.from("hello"), clamped: new Uint8ClampedArray([1, 300]), i8: new Int8Array([-1, 127]), i16: new Int16Array([-300, 5]), u16: new Uint16Array([65535, 5]), i32: new Int32Array([-5, 2147483647]), u32: new Uint32Array([4294967295, 1]), f32: new Float32Array([0.1, NaN]), f64: new Float64Array([0.1, -0, NaN]), big: new BigInt64Array([1n, 2n]), text: "text", longText: "x".repeat(300), number: 5, args: (function () { return arguments; })(1, 2, 3), emptyView: new Uint8Array(0), longView: new Uint8Array(500).fill(3), set: new Set([1]), nothing: null, missing: undefined };
function show(x) { if (x === undefined) return "undefined"; if (typeof x === "function") return "function"; if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length; i++) s += (i ? "," : "") + (i in x ? show(x[i]) : "hole"); return s + "]" + (Object.keys(x).length); } if (ArrayBuffer.isView(x)) return x.constructor.name + "(" + Array.prototype.join.call(x, ",") + ")"; if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x); if (typeof x === "bigint") return x + "n"; return typeof x === "object" && x ? "{" + Object.keys(x).join() + "}" : JSON.stringify(x); }
let hash = 0; function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; }

const table = { first(data) { const out = new Float64Array(40); for (let i = 0; i < data.length; i++) out[i] = data[i]; return out; }, second(data) { return data; } }; function call(data) { return table[data === all ? "second" : "first"](data); }
for (let round = 0; round < 3; round++) for (const name of Object.keys(all)) { let s; try { s = show(call(all[name])); } catch (e) { s = e.constructor.name + ": " + e.message; } note(name + s); if (!round) console.log(name, s.length > 200 ? s.slice(0, 200) + s.length : s); }
console.log(hash);
