"use strict";
// One site reads the length of every kind of value: Buffers as they are made, changed, detached, over memory that grows and shrinks, and what is no Buffer.
const seen = [];
function length(value) { return value.length; }
function isThree(value) { return value.length === 3; }
function isZero(value) { if (value.length === 0) return "zero"; return "more"; }
class OwnBytes extends Uint8Array {}
class Getter extends Uint8Array { get length() { return 77; } }
const resizable = new ArrayBuffer(4, { maxByteLength: 16 });
const shared = new SharedArrayBuffer(6);
const growable = new SharedArrayBuffer(6, { maxByteLength: 12 });
const detached = Buffer.from(new ArrayBuffer(9));
structuredClone(detached.buffer, { transfer: [detached.buffer] });
const own = Buffer.from("own"); Object.defineProperty(own, "length", { value: 42 });
const ownGetter = Buffer.from("own"); Object.defineProperty(ownGetter, "length", { get() { seen.push("got"); return 5; } });
const moved = Buffer.from("moved"); Object.setPrototypeOf(moved, { length: "proto" });
const extra = Buffer.from("extra"); extra.more = 1;
const frozenLike = Buffer.from("nonext"); Object.preventExtensions(frozenLike);
const tracked = Buffer.from(resizable), fixed = Buffer.from(resizable, 1, 3), end = new Uint8Array(growable);
const values = () => [Buffer.from("abc"), Buffer.alloc(0), Buffer.allocUnsafe(3), Buffer.from(shared), Buffer.from(growable), tracked, fixed, end, detached, own, ownGetter, moved, extra, frozenLike,
  new Uint8Array(3), new Uint8ClampedArray(2), new Int16Array(3), new Float64Array(0), new BigInt64Array(3), new OwnBytes(3), new Getter(3), new DataView(new ArrayBuffer(3)), [1, 2, 3], [1.5], [, 1], [], new Array(3), "abc", "", "a".repeat(3) + String(values.name), new String("abc"), { length: 3 }, { length: -0 }, { length: "3" }, {}, function (a, b, c) {}, () => 0, (function () { return arguments; })(1, 2, 3), new Map, 5, true, Symbol.iterator, 10n,
  Buffer.from("subarray").subarray(1, 4), Buffer.concat([Buffer.from("a"), Buffer.from("bc")]), Buffer.from([]), new Proxy(Buffer.from("abc"), {})];
function show(title) {
  const out = [];
  for (const value of values()) for (const ask of [length, isThree, isZero]) {
    try { out.push(String(ask(value))); } catch (error) { out.push(error.name); }
  }
  for (const value of [null, undefined]) try { length(value); } catch (error) { out.push(error.message); }
  console.log("#", title, seen.length, out.join(" "));
}
for (let i = 0; i < 4; i++) show("first");
resizable.resize(9); growable.grow(12); show("resized");
resizable.resize(2); show("out of bounds");
resizable.resize(16); show("back");
const plain = Buffer.from("plain");
Object.defineProperty(plain, "length", { get: () => 99, configurable: true });
show("own accessor");
console.log(length(plain), length(Buffer.from("new")));
