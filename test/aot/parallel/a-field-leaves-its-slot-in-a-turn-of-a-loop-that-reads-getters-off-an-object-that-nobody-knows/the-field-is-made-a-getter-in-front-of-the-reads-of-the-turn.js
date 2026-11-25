class A {  constructor(n) { this.n = n; } get size() { return this.n; } get twice() { return this.n * 2; } put(v) { this.n = v; } step() { this.n++; } }
class B {  constructor(n) { this.pad = 0; this.n = n; } get size() { return this.n + 1; } get twice() { return this.n; } put(v) { this.n = v; } step() { this.n += 2; } }
class C {  constructor(n) { this.n = n; this.text = "c"; this.more = 0; } get size() { return this.n - 1; } get twice() { return this.more; } put(v) { this.more = v; this.n = v; } step() { this.more++; } }
const holder = { items: [] };
globalThis.heldForReaders = holder;
function unknown(i) { return Reflect.get(globalThis, "heldForReaders").items[i]; }
const values = [1, 2147483647, 1.5, -0, NaN, "text", undefined, null, true, 5n, { valueOf() { return 8; } }, [3], () => 1, 2147483648, "7", Infinity];
function say(v) { try { return Object.is(v, -0) ? "-0" : typeof v + ":" + (typeof v === "object" && v !== null ? (Array.isArray(v) ? "list" : "object") : typeof v === "function" ? "f" : String(v)); } catch (error) { return "unsayable"; } }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name; } }
function storeInFront(r, v, when, n) { let out = ""; for (let i = 0; i < n; i++) { if (i === when) r.put(v); out += say(r.size) + say(r.twice) + " "; } return out; }
for (let k = 0; k < 3; k++) { holder.items = [new A(4), new B(5), new C(6)]; const r = unknown(k); r.put = (v) => ((r) => Object.defineProperty(r, "n", { get() { return "got"; }, configurable: true }))(r); console.log("storeInFront", k, tried(() => storeInFront(r, 1, 2, 5))); }
