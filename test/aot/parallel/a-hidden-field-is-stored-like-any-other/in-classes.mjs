class Hidden {
  constructor(seed, configurable = true) {
    Object.defineProperty(this, "size", { value: seed, writable: true, enumerable: false, configurable });
    Object.defineProperty(this, "held", { value: null, writable: true, enumerable: false, configurable });
  }
  set(v) { this.size = v; }
  hold(v) { this.held = v; }
  add(v) { this.size += v; }
  drop() { delete this.size; }
}
class Pinned { constructor() { Object.defineProperty(this, "n", { value: 1 }); } put(v) { this.n = v; } }
class Late { constructor(f) { if (f) Object.defineProperty(this, "x", { value: 1, writable: true, enumerable: false, configurable: true }); } put(v) { this.x = v; } }
class Base { constructor() { Object.defineProperty(this, "size", { value: 1, writable: true, enumerable: false, configurable: true }); } put(v) { this.size = v; } }
class Field extends Base { size = 5; }
class Wide { constructor() { for (let i = 0; i < 40; i++) this["f" + i] = i; Object.defineProperty(this, "size", { value: 1, writable: true, enumerable: false, configurable: true }); } put(v) { this.size = v; } }
const show = (o) => JSON.stringify(Object.getOwnPropertyDescriptors(o)) + " " + Object.keys(o).join();
const tell = (name, f) => { try { console.log(name, f()); } catch (e) { console.log(name, e.name, e.message); } };
const values = [1, -5, 2147483647, 1.5, NaN, "text", true, null, undefined, { a: 1 }, [1], 10n, Symbol.iterator.description, -0];
for (let round = 0; round < 3; round++) {
  for (const configurable of [true, false]) {
    const h = new Hidden(1, configurable);
    for (const v of values) { h.set(v); h.hold(v); console.log(typeof h.size, Object.is(h.size, v), Object.is(h.held, v), Object.keys(h).length, Object.getOwnPropertyDescriptor(h, "size").enumerable); }
    for (let i = 0; i < 100; i++) { h.set(i); h.add(1); h.hold(i % 2 ? i : "s" + i); }
    console.log(h.size, h.held, Object.keys(h).join());
    tell("drop", () => { h.drop(); h.set(7); return Object.keys(h).join() + Object.getOwnPropertyDescriptor(h, "size").enumerable; });
    tell("define", () => { Object.defineProperty(h, "held", { value: 3 }); h.hold(4); return show(h).length + " " + h.held; });
    const f = Object.freeze(new Hidden(2, configurable));
    tell("frozen", () => { f.set(3); return f.size; });
    const s = Object.seal(new Hidden(2, configurable));
    tell("sealed", () => { s.set(3); return s.size + " " + Object.keys(s).length; });
    const p = Object.preventExtensions(new Hidden(2, configurable));
    tell("fixed", () => { p.set(3); p.drop(); p.set(4); return p.size; });
    const r = new Hidden(2, configurable);
    tell("readonly", () => { Object.defineProperty(r, "size", { writable: false }); r.set(3); return r.size; });
  }
  const pinned = new Pinned();
  tell("pinned", () => { pinned.put(3); return pinned.n; });
  for (const f of [true, false, true]) { const l = new Late(f); l.put(2); l.put("two"); console.log(show(l)); }
  const field = new Field(); field.put(9); console.log(show(field));
  const base = new Base(); base.put(9); base.put({}); console.log(show(base));
  const above = Object.create(new Base()); Base.prototype.put.call(above, 8); console.log(show(above), above.size);
  const w = new Wide(); w.put(2); w.put("x"); console.log(Object.keys(w).length, w.size);
  console.log(JSON.stringify({ ...new Base() }), JSON.stringify(Object.assign(new Base(), { size: 4 })), Object.keys(Object.assign(new Base(), { size: 4 })).length);
  Object.defineProperty(Base.prototype, "late" + round, { set(v) { console.log("setter", v); }, configurable: true });
}
const held = []; for (let i = 0; i < 20000; i++) { const h = new Hidden(i); h.hold({ i }); h.set({ i }); held.push(h); }
console.log(held.every((h, i) => h.held.i === i && h.size.i === i));
