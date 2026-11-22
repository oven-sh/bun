// Literals with getters that Object.freeze, seal, preventExtensions and assign return, their copies, and types that list values where the literal declares accessors.
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + (typeof d.value === "function" ? "f" : String(d.value)) : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h") + (d.configurable ? "" : "f") + (d.writable === false ? "r" : ""); }).join(" ");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
let reads = 0;
const frozen = Object.freeze({ base: 10, get next() { return this.base + ++reads; }, apply(x) { return x; } });
const sealed = Object.seal({ base: 20, get next() { return this.base + ++reads; }, set next(v) { this.base = v; } });
const closed = Object.preventExtensions({ get next() { return ++reads; }, base: 30 });
const nested = Object.freeze(Object.seal({ get next() { return ++reads; }, inner: Object.freeze({ get next() { return -reads; } }) }));
const assigned = Object.assign({ get next() { return ++reads; }, base: 1 }, { base: 40 });
const made = (n) => Object.freeze({ n, get next() { return this.n + ++reads; } });
const plain = { base: 5, next: 6, apply: (x) => x };
function read(o) { return o.base + o.next; }
function copy(o) { return { ...o }; }
for (let turn = 0; turn < 12; turn++) {
  for (const o of [frozen, sealed, closed, nested, assigned, made(turn), plain]) {
    const taken = { ...o };
    console.log(turn, tell(o), tell(taken), read(o), read(taken), tell(copy(o)), attempt(() => { o.next = 7; return o.next; }), attempt(() => { taken.next = 8; return taken.next; }), Object.isFrozen(o), Object.isFrozen(taken), reads);
  }
}
function run(n) { const taken = { ...frozen }; const { base, ...rest } = frozen; return [taken.next, typeof taken.next, rest.next, taken.apply(n), reads, Object.keys(frozen).join("+"), Object.values(frozen).length].join(); }
let last = ""; for (let n = 0; n < 300; n++) last = run(n); console.log(last);
