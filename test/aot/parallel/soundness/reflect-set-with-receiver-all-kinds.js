// Reflect set with a receiver of every kind.
const show = (label, ...values) => console.log(label, ...values.map(value => (typeof value === "function" ? "function " + value.name : JSON.stringify(value))));
function run(turn) {
  { const t = { a: 1 }, r = { b: 2 }; show("data, other receiver", Reflect.set(t, "a", turn, r), t, r); }
  { const t = { a: 1 }; show("data, itself", Reflect.set(t, "a", turn, t), t, t.a + 1); }
  { const t = {}, r = {}; show("absent", Reflect.set(t, "n", turn, r), t, r, r.n); }
  { let seen; const t = { set x(v) { seen = this; this.got = v; } }, r = { k: 1 }; show("setter", Reflect.set(t, "x", turn, r), seen === r, r, t); }
  { let seen; const base = { set x(v) { seen = this; this.got = v * 2; } }, t = Object.create(base), r = {}; show("inherited setter", Reflect.set(t, "x", turn, r), seen === r, r.got); }
  { class P { x = 1; y = 2; } const t = new P(), r = new P(); show("instances", Reflect.set(t, "x", turn, r), t.x, r.x, t.y + r.y); }
  { class P { #v = 0; set v(n) { this.#v = n; } get v() { return this.#v; } } const t = new P(), r = new P(); show("private", Reflect.set(t, "v", turn, r), t.v, r.v); try { Reflect.set(t, "v", 1, {}); } catch (error) { show("private refused", error.name); } }
  { const t = Object.freeze({ a: 1 }), r = {}; show("frozen target", Reflect.set(t, "a", turn, r), r); }
  { const t = { a: 1 }, r = Object.freeze({}); show("frozen receiver", Reflect.set(t, "a", turn, r), r); }
  { const t = { a: 1 }; show("primitive receiver", Reflect.set(t, "a", turn, 5), Reflect.set(t, "a", turn, "s"), Reflect.set(t, "a", turn, undefined), t); }
  { const log = []; const t = new Proxy({}, { set(target, key, value, receiver) { log.push(key, value, receiver === r); return true; } }); const r = { z: 1 }; show("proxy target", Reflect.set(t, "p", turn, r), log, r); }
  { const log = []; const r = new Proxy({}, { defineProperty(target, key, descriptor) { log.push(key, descriptor.value); return Reflect.defineProperty(target, key, descriptor); }, getOwnPropertyDescriptor(target, key) { log.push("asked " + key); return Reflect.getOwnPropertyDescriptor(target, key); } }); show("proxy receiver", Reflect.set({}, "p", turn, r), log, r.p); }
  { const inner = { a: 1 }; const p = new Proxy(inner, { set(target, key, value, receiver) { return Reflect.set(target, key, value, receiver); } }); p.a = turn; p.b = turn + 1; show("forwarding trap", inner, p.a, p.b); }
  { const t = [1, 2, 3], r = []; show("arrays", Reflect.set(t, 1, turn, r), Reflect.set(t, "length", 1, r), t, r, r.length); }
  { const t = { get a() { return 1; } }, r = {}; show("getter alone", Reflect.set(t, "a", turn, r), r); }
  { const r = { get a() { return 1; }, set a(v) { this.hit = v; } }; show("accessor on the receiver", Reflect.set({ a: 0 }, "a", turn, r), r.hit); }
  { let kept; const made = () => ({ tag: turn }); Reflect.set({ set x(v) { kept = this; } }, "x", 0, made()); show("fresh receiver is kept", kept, kept.tag); }
  { let kept; Reflect.set({ set x(v) { kept = v; } }, "x", { value: turn }, {}); show("fresh value is kept", kept); }
  { const key = Symbol("k"); const r = {}; show("symbol", Reflect.set({}, key, turn, r), r[key]); }
  { const f = function named() {}; let what; Reflect.set({ set x(v) { what = this.constructor === Function; } }, "x", 0, f); show("function receiver", what); }
  { const t = { set x(v) { throw new RangeError("no " + v); } }; try { Reflect.set(t, "x", turn, {}); } catch (error) { show("setter throws", error.message); } }
  { try { Reflect.set(1, "x", 1, {}); } catch (error) { show("no object", error.name); } }
}
for (let turn = 0; turn < 3; turn++) run(turn);
