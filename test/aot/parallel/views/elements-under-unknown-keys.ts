// Elements of views, lists, strings and other objects that nobody types, read and written under integers, doubles and strings.
// Every answer is compared with what the same view gives through its own methods.
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const values: any[] = [0, 1, -1, 127, 128, 255, 256, -128, -129, 32767, 32768, 65535, 65536, 2147483647, -2147483648, 0.5, -0.5, 1.5, 254.5, 255.5, -1.5, 2147483648, 4294967295, 4294967296, 4294967297.5, 1e20, -1e20, NaN, Infinity, -Infinity, -0, true, false, undefined, null, "12", "x", { valueOf: () => 77 }];
const keys: any[] = [0, 1, 2, 3, -1, 4, 100, 2147483647, -2147483648, 4294967295, 4294967296, 1.5, NaN, -0, 2.0, "0", "3", "4", "-1", "x", "01"];

function read(o: any, k: any): any { return o[k]; }
function write(o: any, k: any, v: any): any { o[k] = v; return o; }
function writeStrict(o: any, k: any, v: any): any { "use strict"; o[k] = v; return o; }
function sumIn(o: any, n: any): any { let s: any = 0; for (let i = 0; i < n; i++) s += o[i]; return s; }
function fillIn(o: any, n: any, v: any): any { for (let i = 0; i < n; i++) o[i] = v; return o; }
function first(o: any): any { return o[0]; }
function third(o: any): any { return o[2]; }

let checks = 0, hash = 0;
function note(v: any): void {
  const t = typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "object" && v !== null ? "object" : String(v);
  for (let i = 0; i < t.length; i++) hash = (Math.imul(hash, 31) + t.charCodeAt(i)) | 0;
  checks++;
}
let wrong = 0;
function check(what: string, found: any, wanted: any): void {
  if (!Object.is(found, wanted)) { if (wrong++ < 20) console.log("WRONG", what, String(found), String(wanted)); }
  note(found);
}

for (const K of kinds) {
  const reference: any = new K(4);
  for (const v of values) {
    const o: any = new K(4);
    reference.set([v === undefined ? undefined : v], 1);
    write(o, 1, v);
    check(`${K.name} store ${String(v)}`, o.at(1), reference.at(1));
    check(`${K.name} read`, read(o, 1), reference.at(1));
    for (const k of keys) {
      const p: any = K.from([1, 2, 3, 4]);
      write(p, k, v);
      writeStrict(p, k, v);
      for (let i = 0; i < 4; i++) note(read(p, i));
      note(read(p, k));
      note(first(p)); note(third(p)); note(sumIn(p, 4)); note(sumIn(p, 6));
      note(Object.keys(p).length);
    }
    const f: any = fillIn(new K(5), 5, v);
    note(sumIn(f, 5));
    fillIn(f, 8, v);
    note(f.length); note(read(f, 6));
  }
}
// views of all forms: offset, resizable, length tracking, shared, detached
const buffer = new ArrayBuffer(16, { maxByteLength: 32 });
const tracking: any = new Uint8Array(buffer);
const fixed: any = new Uint16Array(buffer, 4, 2);
for (let i = 0; i < 20; i++) { write(tracking, i, i + 250); note(read(tracking, i)); write(fixed, i, i * 70000); note(read(fixed, i)); }
buffer.resize(24); for (let i = 0; i < 26; i++) { write(tracking, i, i * 3); note(read(tracking, i)); note(read(fixed, i)); }
buffer.resize(6); for (let i = 0; i < 8; i++) { note(read(tracking, i)); note(read(fixed, i)); write(fixed, i, 9); write(tracking, i, 7); }
note(tracking.length); note(fixed.length);
const shared: any = new Int32Array(new SharedArrayBuffer(16)); for (let i = -1; i < 6; i++) { write(shared, i, i * 1e9); note(read(shared, i)); }
const gone = new ArrayBuffer(16); const onGone: any = new Float64Array(gone); write(onGone, 1, 2.5); note(read(onGone, 1)); structuredClone(gone, { transfer: [gone] });
for (let i = 0; i < 3; i++) { note(read(onGone, i)); write(onGone, i, 1); } note(onGone.length);
const big: any = new BigInt64Array(3); write(big, 1, 5n); note(read(big, 1)); note(read(big, 9)); try { write(big, 0, 5); note("no"); } catch (e: any) { note(e.constructor.name); }
const bigs: any = new BigUint64Array(3); write(bigs, 1, -1n); note(read(bigs, 1));
const half: any = typeof (globalThis as any).Float16Array === "function" ? new (globalThis as any).Float16Array(3) : [0, 1.5, 0]; write(half, 1, 1.5); note(read(half, 1)); note(read(half, 5));
const data: any = new DataView(new ArrayBuffer(8)); write(data, 0, "own"); note(read(data, 0)); note(read(data, 1));
// what is no view: strings, arguments, objects with elements, lists of each kind, holes, accessors, proxies
for (const s of ["", "abc", "aሴb", "x".repeat(40) + "y", "ab" + String(values.length)]) for (const k of keys) note(read(s, k));
function argumentsOf(..._: any[]): any { return (function (): any { return arguments; }).apply(null, _ as any); }
const passed = argumentsOf(1, "two", 3.5); for (const k of keys) { note(read(passed, k)); } write(passed, 1, 9); note(read(passed, 1)); write(passed, 5, 6); note(read(passed, 5));
class Holder { name = "h"; [key: string]: any; }
const holder: any = new Holder(); for (const k of keys) { note(read(holder, k)); write(holder, k, `v${String(k)}`); note(read(holder, k)); } note(sumIn(holder, 4));
const literal: any = { a: 1 }; for (const k of keys) { write(literal, k, 1); note(read(literal, k)); } note(Object.keys(literal).join());
for (const list of [[1, 2, 3, 4], [1.5, 2.5, NaN, 4], ["a", 1, {}, null], [1, , 3, ,], [], new Array(5), Object.freeze([1, 2, 3])] as any[]) for (const k of keys) {
  note(read(list, k)); try { writeStrict(list, k, 7); } catch (e: any) { note(e.constructor.name); } note(read(list, k)); if (list.length > 1000) list.length = 4;
}
const getter: any = { get 0() { return "got"; }, set 1(v: any) { hash ^= v; } }; note(read(getter, 0)); write(getter, 1, 5); note(read(getter, 1));
const proxy: any = new Proxy([1, 2, 3], { get: (t: any, k: any) => (k === "1" ? "trap" : t[k]), set: (t: any, k: any, v: any) => { t[k] = v + 1; return true; } }); for (const k of keys.slice(0, 5)) { note(read(proxy, k)); write(proxy, k, 4); } note(sumIn(proxy, 3));
for (const o of [1, 1.5, true, Symbol.iterator, 5n, () => 1, /x/, new Date(0), new Map()] as any[]) for (const k of keys) { note(read(o, k)); try { writeStrict(o, k, 1); } catch (e: any) { note(e.constructor.name); } }
for (const o of [null, undefined] as any[]) { try { read(o, 0); note("no"); } catch (e: any) { note(e.constructor.name); } try { write(o, 0, 1); note("no"); } catch (e: any) { note(e.constructor.name); } }
console.log(checks, hash, wrong);
