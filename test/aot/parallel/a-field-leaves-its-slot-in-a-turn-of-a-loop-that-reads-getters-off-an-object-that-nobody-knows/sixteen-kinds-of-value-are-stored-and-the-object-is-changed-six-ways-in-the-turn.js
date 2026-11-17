class A {  constructor(n) { this.n = n; } get size() { return this.n; } get twice() { return this.n * 2; } put(v) { this.n = v; } step() { this.n++; } }
class B {  constructor(n) { this.pad = 0; this.n = n; } get size() { return this.n + 1; } get twice() { return this.n; } put(v) { this.n = v; } step() { this.n += 2; } }
class C {  constructor(n) { this.n = n; this.text = "c"; this.more = 0; } get size() { return this.n - 1; } get twice() { return this.more; } put(v) { this.more = v; this.n = v; } step() { this.more++; } }
const holder = { items: [] };
globalThis.heldForReaders = holder;
function unknown(i) { return Reflect.get(globalThis, "heldForReaders").items[i]; }
const values = [1, 2147483647, 1.5, -0, NaN, "text", undefined, null, true, 5n, { valueOf() { return 8; } }, [3], () => 1, 2147483648, "7", Infinity];
function say(v) { try { return Object.is(v, -0) ? "-0" : typeof v + ":" + (typeof v === "object" && v !== null ? (Array.isArray(v) ? "list" : "object") : typeof v === "function" ? "f" : String(v)); } catch (error) { return "unsayable"; } }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name; } }
function twiceInTurn(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { const a = r.size; if (i === when) r.put(v); const b = r.size; out += say(a) + "/" + say(b) + " "; } return out; }
function storeAtEnd(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { out += say(r.size) + " "; if (i === when) r.put(v); } return out; }
function storeInFront(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { if (i === when) r.put(v); out += say(r.size) + say(r.twice) + " "; } return out; }
function summed(r, v, when, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += r.size * 2 + 1; if (i === when) r.put(v); sum += r.twice; } return say(sum); }
function byField(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { const a = r.n; if (i === when) r.n = v; out += say(a) + say(r.size) + say(r.n) + " "; } return out; }
function stepped(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { r.step(); if (i === when) r.put(v); out += say(r.size) + " "; r.step(); out += say(r.twice) + " "; } return out; }
function inner(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) { out += say(r.size); if (j === 1 && i === when) r.put(v); } out += say(r.size) + " "; } return out; }
function asTest(r, v, when, n) { let hits = 0; for (let i = 0; i < n; i++) { if (r.size > 3) hits++; if (i === when) r.put(v); if (r.size === v) hits += 10; if (r.twice) hits += 100; } return hits; }
function caught(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { try { out += say(r.size) + " "; if (i === when) r.put(v); out += say(r.size + 1) + " "; } catch (error) { out += "E "; } } return out; }
for (const v of values) for (const when of [0, 2, 5]) {
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("twiceInTurn", say(v), when, k, tried(() => twiceInTurn(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("storeAtEnd", say(v), when, k, tried(() => storeAtEnd(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("storeInFront", say(v), when, k, tried(() => storeInFront(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("summed", say(v), when, k, tried(() => summed(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("byField", say(v), when, k, tried(() => byField(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("stepped", say(v), when, k, tried(() => stepped(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("inner", say(v), when, k, tried(() => inner(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("asTest", say(v), when, k, tried(() => asTest(unknown(k), v, when, 7)));
  holder.items = [new A(4), new B(5), new C(6), { n: 3, size: 2, twice: 1, put(v) { this.n = v; this.size = v; }, step() { this.n++; } }];
  for (let k = 0; k < 4; k++) console.log("caught", say(v), when, k, tried(() => caught(unknown(k), v, when, 7)));
}
for (const change of [(r) => Object.defineProperty(r, "n", { value: "laid", writable: true, configurable: true, enumerable: true }), (r) => Object.defineProperty(r, "n", { get() { return "got"; }, configurable: true }), (r) => { delete r.n; }, (r) => Object.freeze(r), (r) => Object.defineProperty(r, "size", { value: "over", configurable: true }), (r) => Object.setPrototypeOf(r, { size: "above", twice: 1, put() {}, step() {} })]) {
  for (let k = 0; k < 3; k++) { holder.items = [new A(4), new B(5), new C(6)]; const r = unknown(k); r.put = (v) => change(r); console.log("twiceInTurn", k, tried(() => twiceInTurn(r, 1, 2, 5))); }
}
for (const change of [(r) => Object.defineProperty(r, "n", { value: "laid", writable: true, configurable: true, enumerable: true }), (r) => Object.defineProperty(r, "n", { get() { return "got"; }, configurable: true }), (r) => { delete r.n; }, (r) => Object.freeze(r), (r) => Object.defineProperty(r, "size", { value: "over", configurable: true }), (r) => Object.setPrototypeOf(r, { size: "above", twice: 1, put() {}, step() {} })]) {
  for (let k = 0; k < 3; k++) { holder.items = [new A(4), new B(5), new C(6)]; const r = unknown(k); r.put = (v) => change(r); console.log("storeAtEnd", k, tried(() => storeAtEnd(r, 1, 2, 5))); }
}
for (const change of [(r) => Object.defineProperty(r, "n", { value: "laid", writable: true, configurable: true, enumerable: true }), (r) => Object.defineProperty(r, "n", { get() { return "got"; }, configurable: true }), (r) => { delete r.n; }, (r) => Object.freeze(r), (r) => Object.defineProperty(r, "size", { value: "over", configurable: true }), (r) => Object.setPrototypeOf(r, { size: "above", twice: 1, put() {}, step() {} })]) {
  for (let k = 0; k < 3; k++) { holder.items = [new A(4), new B(5), new C(6)]; const r = unknown(k); r.put = (v) => change(r); console.log("storeInFront", k, tried(() => storeInFront(r, 1, 2, 5))); }
}
