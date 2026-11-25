class A { constructor(n) { this.n = n; } get twice() { return this.n * 2; } get size() { return this.n; } }
class B { constructor(n) { this.pad = 0; this.n = n; } get twice() { return this.n + 100; } get size() { return this.n + 1; } }
class C { constructor(n) { this.n = n; this.more = 7; } get twice() { return this.more; } get size() { return this.n - 1; } }
const holder = { items: [] };
globalThis.heldForReaders = holder;
function unknown(i) { return Reflect.get(globalThis, "heldForReaders").items[i]; }
function say(v) { return typeof v + ":" + String(v); }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name; } }
function inFront(r, when, n, change) { let out = ""; for (let i = 0; i < n; i++) { if (i === when) change(r); out += say(r.twice) + " "; } return out; }
function behind(r, when, n, change) { let out = ""; for (let i = 0; i < n; i++) { out += say(r.twice) + " "; if (i === when) change(r); } return out; }
function between(r, when, n, change) { let out = ""; for (let i = 0; i < n; i++) { const a = r.twice; if (i === when) change(r); out += say(a) + "/" + say(r.twice) + " "; } return out; }
function summed(r, when, n, change) { let sum = 0; for (let i = 0; i < n; i++) { if (i === when) change(r); sum += r.twice * 2 + 1; } return say(sum); }
const changes = {
  fieldGone: (r) => { delete r.n; delete r.more; },
  fieldMadeGetter: (r) => { Object.defineProperty(r, "n", { get() { return 40; }, configurable: true }); Object.defineProperty(r, "more", { get() { return 41; }, configurable: true }); },
  fieldGoneAndBack: (r) => { delete r.n; r.n = 9; delete r.more; r.more = 8; },
  frozen: (r) => Object.freeze(r),
  another: (r) => { r.extra = 1; r[Symbol.iterator] = 2; r[3] = 4; },
};
function fresh() { holder.items = [new A(4), new B(5), new C(6)]; }
for (const [name, change] of Object.entries(changes)) for (let k = 0; k < 3; k++) {
  fresh(); console.log(name, "inFront", 0, k, tried(() => inFront(unknown(k), 0, 5, change)));
  fresh(); console.log(name, "inFront", 2, k, tried(() => inFront(unknown(k), 2, 5, change)));
  fresh(); console.log(name, "inFront", 4, k, tried(() => inFront(unknown(k), 4, 5, change)));
  fresh(); console.log(name, "behind", 0, k, tried(() => behind(unknown(k), 0, 5, change)));
  fresh(); console.log(name, "behind", 2, k, tried(() => behind(unknown(k), 2, 5, change)));
  fresh(); console.log(name, "behind", 4, k, tried(() => behind(unknown(k), 4, 5, change)));
  fresh(); console.log(name, "between", 0, k, tried(() => between(unknown(k), 0, 5, change)));
  fresh(); console.log(name, "between", 2, k, tried(() => between(unknown(k), 2, 5, change)));
  fresh(); console.log(name, "between", 4, k, tried(() => between(unknown(k), 4, 5, change)));
  fresh(); console.log(name, "summed", 0, k, tried(() => summed(unknown(k), 0, 5, change)));
  fresh(); console.log(name, "summed", 2, k, tried(() => summed(unknown(k), 2, 5, change)));
  fresh(); console.log(name, "summed", 4, k, tried(() => summed(unknown(k), 4, 5, change)));
}
