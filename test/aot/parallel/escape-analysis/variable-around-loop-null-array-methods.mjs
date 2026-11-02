// A variable around a loop holds null, an array literal, or an object made by a function that adds a member on one path, and whose methods close over one counter. The build aborted: allocation sinking asked only while it rewrote whether the closures can be built in the arms of the switch on the holder's tag, and two of them hold the same environment.
class List extends Array {}
class Bytes extends Uint8Array {}
class Table extends Map {}
class Bag extends Set {}
const key = { key: 1 }, other = { other: 1 };
let closed = 0;
const lengthOfTyped = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get;
const sizeOfMap = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
function count() { return arguments.length; }
function gather(first, ...rest) { return rest; }
function sparse() { const a = [1, 2, 3]; a[20000] = 4; return a; }
function withLength(a, length) { a.length = length; return a; }
function pushed(...all) { const a = []; for (let i = 0; i < all.length; i++) a.push(all[i]); return a; }
function shifted(a) { a.shift(); return a; }
function filledBytes(a) { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; }
function resizable(length, most) { const b = new ArrayBuffer(length, { maxByteLength: most }); filledBytes(new Uint8Array(b)); return b; }
function resized(a, length) { a.buffer.resize(length); return a; }
function grown(a, length) { filledBytes(a); a.buffer.grow(length); return a; }
function detached(a) { a.buffer.transfer(); return a; }
function valuesThenDetached() { const a = new Uint8Array([1, 2, 3]), it = a.values(); it.next(); a.buffer.transfer(); return it; }
function withoutKey(c, k) { c.delete(k); return c; }
function cleared(c) { c.clear(); return c; }
function started(it, steps = 1) { for (let i = 0; i < steps; i++) it.next(); return it; }
function form() { const f = new FormData(); f.append("a", "1"); f.append("b", "2"); f.append("a", "3"); return f; }
function counter(most, hasReturn) { let n = 0; const it = { next() { return n < most ? { done: false, value: ++n } : { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } }; if (hasReturn) it.return = function () { closed++; n = most; return {}; }; return it; }
function showList(r, depth) { const n = r.length; let s = ""; for (let i = 0; i < n; i++) { if (n > 48 && i === 8) { s += ",.." + n + ".."; i = n - 8; } s += (i ? "," : "") + (i in r ? show(r[i], depth + 1) : "hole"); } return s; }
function show(r, depth = 0) {
  if (r === undefined) return "undefined";
  if (r === null) return "null";
  switch (typeof r) {
    case "number": return Object.is(r, -0) ? "-0" : String(r);
    case "string": return r.length > 400 ? JSON.stringify(r.slice(0, 100)) + ".." + r.length : JSON.stringify(r);
    case "bigint": return r + "n";
    case "boolean": return String(r);
    case "symbol": return String(r);
    case "function": return "function " + r.name;
  }
  if (depth > 4) return "deep";
  try {
    const tag = Object.prototype.toString.call(r).slice(8, -1);
    let named = "";
    for (const k of Reflect.ownKeys(r)) if (typeof k === "symbol" || (k !== "length" && k !== "callee" && String(k >>> 0) !== k)) { const d = Reflect.getOwnPropertyDescriptor(r, k); named += " " + String(k) + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }
    if (Array.isArray(r)) return (Object.getPrototypeOf(r) === Array.prototype ? "" : "child") + "[" + showList(r, depth) + "]" + named;
    if (r instanceof Map) return tag + "{" + showList(Array.from(Map.prototype.entries.call(r)), depth) + "}" + named;
    if (r instanceof Set) return tag + "{" + showList(Array.from(Set.prototype.values.call(r)), depth) + "}" + named;
    if (r instanceof DataView) { let s; try { s = r.byteLength + "@" + r.byteOffset + " " + show(r.buffer, depth + 1); } catch (e) { s = e.name; } return tag + "(" + s + ")" + named; }
    if (ArrayBuffer.isView(r)) return r.constructor.name + "(" + r.length + "@" + r.byteOffset + ")[" + showList(r, depth) + "]" + named;
    if (r instanceof ArrayBuffer || r instanceof SharedArrayBuffer) return tag + "(" + r.byteLength + "/" + r.maxByteLength + ")[" + showList(new Uint8Array(r), depth) + "]" + named;
    if (r instanceof WeakMap || r instanceof WeakSet) return tag + "(" + r.has(key) + "," + r.has(other) + ")" + named;
    if (r instanceof URLSearchParams || r instanceof Headers || r instanceof FormData) return tag + "{" + showList(Array.from(r), depth) + "}" + named;
    if (r instanceof Error) return r.name + ": " + r.message;
    if (typeof r.next === "function") { const rest = []; for (let i = 0; i < 12; i++) { const step = r.next(); if (step.done) break; rest.push(step.value); } return tag + " with " + showList(rest, depth) + " left"; }
    let indexed = "";
    for (const k of Reflect.ownKeys(r)) if (typeof k === "string" && (k === "length" || String(k >>> 0) === k)) { const d = Reflect.getOwnPropertyDescriptor(r, k); indexed += " " + k + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }
    return tag + "{" + indexed + named + " }";
  } catch (e) { return "cannot be shown: " + e.name; }
}
function use1(v) { return v.length ?? v.size; }
function ask1(turns) { let v = null; const r = []; for (let i = 0; i < turns; i++) { if (v !== null) r.push(show(use1(v))); v = i % 3 === 0 ? [1.5, 2.5, 3.5] : i % 3 === 1 ? counter(3, true) : null; } return r; }
function attempt1(v) { try { return show(ask1(v + 4)); } catch (e) { return "threw " + e.name; } }
let last1 = ""; for (let n = 0; n < 20; n++) last1 = attempt1(0);
console.log("lengthOrSize, hot:", last1);
for (let n = 0; n < 3; n++) console.log("lengthOrSize, then:", attempt1(1));
console.log("lengthOrSize, again:", attempt1(0));
