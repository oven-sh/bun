// Lists in slots of an object in a slot, in iterations: lists of every storage, array-likes, views, subclasses, proxies, accessors, strings, nothing.
"use strict";
const out = [];
let n = 0;
class State { init(v) { this.list = [v]; this.other = ["o"]; this.pos = v; this.name = "n"; this.depth = 0.5; return this; } grow() { this.list.push(this.pos); return this.list.length - 1; } top() { return this.list[this.list.length - 1]; } }
class Owner {
  constructor(s) { this.state = s; }
  m0(i) { return this.state.list[this.state.list.length - 1]; }
  s0(i) { const s = this.state; return s.list[s.list.length - 1]; }
  m1(i) { return this.state.list[this.state.list.length - i]; }
  s1(i) { const s = this.state; return s.list[s.list.length - i]; }
  m2(i) { return this.state.list[0] + this.state.list.length; }
  s2(i) { const s = this.state; return s.list[0] + s.list.length; }
  m3(i) { return this.state.list.length ? this.state.list[i] : "none"; }
  s3(i) { const s = this.state; return s.list.length ? s.list[i] : "none"; }
  m4(i) { return [this.state.list[0], this.state.list[1]].length + this.state.list.length; }
  s4(i) { const s = this.state; return [s.list[0], s.list[1]].length + s.list.length; }
  m5(i) { return this.state.list[this.state.list.length >> 1]; }
  s5(i) { const s = this.state; return s.list[s.list.length >> 1]; }
  m6(i) { return this.state.list[this.state.list.length - 1 - i]; }
  s6(i) { const s = this.state; return s.list[s.list.length - 1 - i]; }
  m7(i) { return this.state.list["length"] + this.state.list["0"]; }
  s7(i) { const s = this.state; return s.list["length"] + s.list["0"]; }
  m8(i) { return this.state.list[this.state.list[0]] ?? this.state.list.length; }
  s8(i) { const s = this.state; return s.list[s.list[0]] ?? s.list.length; }
  m9(i) { return this.state.list.length - this.state.list[i]; }
  s9(i) { const s = this.state; return s.list.length - s.list[i]; }
  m10(i) { return this.state.list[i] === this.state.list[this.state.list.length - 1]; }
  s10(i) { const s = this.state; return s.list[i] === s.list[s.list.length - 1]; }
  m11(i) { return this.state.other.length + this.state.list[this.state.other.length]; }
  s11(i) { const s = this.state; return s.other.length + s.list[s.other.length]; }
  m12(i) { return this.state.list[-1] ?? this.state.list.length; }
  s12(i) { const s = this.state; return s.list[-1] ?? s.list.length; }
  m13(i) { return this.state.list[0.5] ?? this.state.list[1.0]; }
  s13(i) { const s = this.state; return s.list[0.5] ?? s.list[1.0]; }
  m14(i) { return typeof this.state.list[this.state.list.length]; }
  s14(i) { const s = this.state; return typeof s.list[s.list.length]; }
  m15(i) { return this.state.list[this.state.list.length - 1]?.x; }
  s15(i) { const s = this.state; return s.list[s.list.length - 1]?.x; }
  m16(i) { return (this.state.list[this.state.list.length] = i, this.state.list.length); }
  s16(i) { const s = this.state; return (s.list[s.list.length] = i, s.list.length); }
  m17(i) { return this.state.list.length + this.state.list[this.state.grow()]; }
  s17(i) { const s = this.state; return s.list.length + s.list[s.grow()]; }
  m18(i) { return (this.state.list.length = 2, this.state.list[1]); }
  s18(i) { const s = this.state; return (s.list.length = 2, s.list[1]); }
  m19(i) { return this.state.list.at(-1) === this.state.list[this.state.list.length - 1]; }
  s19(i) { const s = this.state; return s.list.at(-1) === s.list[s.list.length - 1]; }
  last() { return this.state.list[this.state.list.length - 1]; }
  push(v) { this.state.list.push(v); return this.state.list.length; }
  all(k) {
    let s = "";
    for (let i = 0; i < k; i++) {
      try { s += text(this.m0(i)) + text(this.s0(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m1(i)) + text(this.s1(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m2(i)) + text(this.s2(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m3(i)) + text(this.s3(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m4(i)) + text(this.s4(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m5(i)) + text(this.s5(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m6(i)) + text(this.s6(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m7(i)) + text(this.s7(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m8(i)) + text(this.s8(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m9(i)) + text(this.s9(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m10(i)) + text(this.s10(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m11(i)) + text(this.s11(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m12(i)) + text(this.s12(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m13(i)) + text(this.s13(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m14(i)) + text(this.s14(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m15(i)) + text(this.s15(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m16(i)) + text(this.s16(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m17(i)) + text(this.s17(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m18(i)) + text(this.s18(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.m19(i)) + text(this.s19(i)) + ","; } catch (e) { s += e.constructor.name; }
      try { s += text(this.last()) + text(this.state.top()) + this.push(i); } catch (e) { s += e.constructor.name; }
      if (this.state && this.state.list && this.state.list.length > 60) this.state.list = [i];
    }
    return s;
  }
}
const text = (v) => { try { return typeof v === "bigint" ? v + "n" : typeof v === "function" ? "fn" : v !== null && typeof v === "object" ? "o" + Object.keys(v).length : Object.is(v, -0) ? "-0" : String(v); } catch (e) { return "!"; } };
globalThis.kept = [State, Owner];
if (process.argv[9]) { new State()[process.argv[9]] = 1; new Owner()[process.argv[9]] = 2; }
const show = (t, f) => { let q; try { q = text(f()); } catch (e) { q = e.constructor.name; } out.push(t + " " + q); };
let h;
const fresh = (k) => { h = new Owner(new State().init(k)); };
for (let k = 0; k < 3; k++) { fresh(k); show("k" + k, () => h.all(6)); }
fresh(0); show("v0", () => { h.state.list = []; return h.all(5); });
fresh(0); show("g0", () => { Object.defineProperty(h.state, "list", { get() { n++; return []; }, configurable: true }); return h.all(3); });
fresh(0); show("p0", () => { delete h.state.list; State.prototype.list = []; return h.all(3); }); delete State.prototype.list;
fresh(1); show("v1", () => { h.state.list = [1, 2, 3]; return h.all(5); });
fresh(2); show("v2", () => { h.state.list = [1.5, 2.5]; return h.all(5); });
fresh(3); show("v3", () => { h.state.list = ["a", "b"]; return h.all(5); });
fresh(3); show("g3", () => { Object.defineProperty(h.state, "list", { get() { n++; return ["a", "b"]; }, configurable: true }); return h.all(3); });
fresh(4); show("v4", () => { h.state.list = [{ x: 1 }, null]; return h.all(5); });
fresh(5); show("v5", () => { h.state.list = [, 1, , 2]; return h.all(5); });
fresh(5); show("p5", () => { delete h.state.list; State.prototype.list = [, 1, , 2]; return h.all(3); }); delete State.prototype.list;
fresh(6); show("v6", () => { h.state.list = [undefined, NaN, -0]; return h.all(5); });
fresh(6); show("g6", () => { Object.defineProperty(h.state, "list", { get() { n++; return [undefined, NaN, -0]; }, configurable: true }); return h.all(3); });
fresh(7); show("v7", () => { h.state.list = new Array(4); return h.all(5); });
fresh(8); show("v8", () => { h.state.list = Object.freeze([1, "f"]); return h.all(5); });
fresh(9); show("v9", () => { h.state.list = [1, 2, 3].concat("s"); return h.all(5); });
fresh(9); show("g9", () => { Object.defineProperty(h.state, "list", { get() { n++; return [1, 2, 3].concat("s"); }, configurable: true }); return h.all(3); });
fresh(10); show("v10", () => { h.state.list = "text"; return h.all(5); });
fresh(10); show("p10", () => { delete h.state.list; State.prototype.list = "text"; return h.all(3); }); delete State.prototype.list;
fresh(11); show("v11", () => { h.state.list = { length: 3, 0: "l", 2: "m" }; return h.all(5); });
fresh(12); show("v12", () => { h.state.list = null; return h.all(5); });
fresh(12); show("g12", () => { Object.defineProperty(h.state, "list", { get() { n++; return null; }, configurable: true }); return h.all(3); });
fresh(13); show("v13", () => { h.state.list = undefined; return h.all(5); });
fresh(14); show("v14", () => { h.state.list = 5; return h.all(5); });
fresh(15); show("v15", () => { h.state.list = new Int8Array([1, 2, 3]); return h.all(5); });
fresh(15); show("g15", () => { Object.defineProperty(h.state, "list", { get() { n++; return new Int8Array([1, 2, 3]); }, configurable: true }); return h.all(3); });
fresh(15); show("p15", () => { delete h.state.list; State.prototype.list = new Int8Array([1, 2, 3]); return h.all(3); }); delete State.prototype.list;
fresh(16); show("v16", () => { h.state.list = new Float64Array([0.5, 1.5]); return h.all(5); });
fresh(17); show("v17", () => { h.state.list = new (class extends Array {})(1, 2, 3); return h.all(5); });
fresh(18); show("v18", () => { h.state.list = new Proxy([7, 8], {}); return h.all(5); });
fresh(18); show("g18", () => { Object.defineProperty(h.state, "list", { get() { n++; return new Proxy([7, 8], {}); }, configurable: true }); return h.all(3); });
fresh(19); show("v19", () => { h.state.list = Object.defineProperty([1, 2], 1, { get() { return "got"; }, configurable: true }); return h.all(5); });
fresh(20); show("v20", () => { h.state.list = Object.defineProperty([4, 5], "length", { writable: false }); return h.all(5); });
fresh(20); show("p20", () => { delete h.state.list; State.prototype.list = Object.defineProperty([4, 5], "length", { writable: false }); return h.all(3); }); delete State.prototype.list;
fresh(21); show("v21", () => { h.state.list = new Proxy({ length: 2 }, { get(t, k) { n++; return k === "length" ? 2 : "p" + String(k); } }); return h.all(5); });
fresh(21); show("g21", () => { Object.defineProperty(h.state, "list", { get() { n++; return new Proxy({ length: 2 }, { get(t, k) { n++; return k === "length" ? 2 : "p" + String(k); } }); }, configurable: true }); return h.all(3); });
fresh(22); show("v22", () => { h.state.list = (() => { const l = [1, 2]; l[100] = 3; return l; })(); return h.all(5); });
fresh(23); show("v23", () => { h.state.list = (() => { const l = [1, 2, 3]; delete l[1]; return l; })(); return h.all(5); });
fresh(24); show("v24", () => { h.state.list = Object.setPrototypeOf([1, , 3], { 1: "proto" }); return h.all(5); });
fresh(24); show("g24", () => { Object.defineProperty(h.state, "list", { get() { n++; return Object.setPrototypeOf([1, , 3], { 1: "proto" }); }, configurable: true }); return h.all(3); });
fresh(25); show("v25", () => { h.state.list = (function () { return arguments; })(9, 8); return h.all(5); });
fresh(25); show("p25", () => { delete h.state.list; State.prototype.list = (function () { return arguments; })(9, 8); return h.all(3); }); delete State.prototype.list;
fresh(26); show("v26", () => { h.state.list = { length: "2", 1: "str" }; return h.all(5); });
fresh(27); show("v27", () => { h.state.list = { get length() { n++; return 1; }, 0: "acc" }; return h.all(5); });
fresh(27); show("g27", () => { Object.defineProperty(h.state, "list", { get() { n++; return { get length() { n++; return 1; }, 0: "acc" }; }, configurable: true }); return h.all(3); });
fresh(28); show("v28", () => { h.state.list = [10n, 1n]; return h.all(5); });
fresh(29); show("v29", () => { h.state.list = new String("xy"); return h.all(5); });
fresh(30); show("v30", () => { h.state.list = [[1], [2]]; return h.all(5); });
fresh(30); show("g30", () => { Object.defineProperty(h.state, "list", { get() { n++; return [[1], [2]]; }, configurable: true }); return h.all(3); });
fresh(30); show("p30", () => { delete h.state.list; State.prototype.list = [[1], [2]]; return h.all(3); }); delete State.prototype.list;
show("n", () => n);
for (const line of out) console.log(line.length > 300 ? line.slice(0, 300) + line.length + [...line].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0) : line);
