// What functions that loops reach construct finishes its birth in line, a subclass too, whatever a constructor lets others do to the object.
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
globalThis.watch = null;
class Buoy { constructor(given) { for (const name of Object.keys(given)) this[name] = given[name]; this.rope = {}; if (globalThis.watch) globalThis.watch(this); } text() { return this.tint + ":" + Object.keys(this).join() + Object.keys(this.rope).length; } }
class Float extends Buoy { constructor(given) { super(given); this.lit = false; this.tint = "float"; } }
class Raft extends Buoy { constructor(given) { super(given); this.tint = "raft"; this.moored = []; } moor(craft) { this.moored[this.moored.length] = craft; craft.quay = this; } heft() { let n = 0; for (let i = 0; i < this.moored.length; i++) n += this.moored[i].tint.length; return n + this.tint.length; } }
class Boat extends Raft { constructor(given) { super(given); this.oars = this.moored.length; this.tint = "boat"; } }
class Harbor {
  constructor(text) { this.sea = new Raft({}); this.near = this.sea; this.water = text; this.at = 0; }
  drift() { for (const unit of this.water) { this.at++; if (unit === "}") this.near = this.near.quay || this.sea; else if (unit === "{") this.launch(); else this.other(unit.charCodeAt(0)); } return this.sea; }
  other(c) { for (let i = 0; i < 2; i++) this.float({ mark: String.fromCharCode(c + i), value: i }); }
  float(given) { this.near.moor(new Float(given)); }
  launch() { const boat = new Boat({ sail: "a" }); this.near.moor(boat); this.near = boat; }
}
function walk(craft, depth) { let s = depth + craft.text() + (craft.moored ? craft.heft() : "") + "\n"; if (craft.moored) for (const child of craft.moored) s += walk(child, depth + 1); return s; }
for (const text of ["ab{cd{e}f}g", "", "{{{x", "}}a"]) out.push(show(() => walk(new Harbor(text).drift(), 0)));
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`({
  nothing(n) {}, deleted(n) { del§ete n.rope; }, again(n) { del§ete n.rope; n.rope = { again: 1 }; }, early(n) { n.tint = "early"; }, gone(n) { n.tint = "early"; del§ete n.tint; }, frozen(n) { Ob§ject.freeze(n); }, sealed(n) { Ob§ject.seal(n); }, closed(n) { Ob§ject.preventExtensions(n); },
  locked(n) { Ob§ject.defineProperty(n, "tint", { value: "locked", configurable: true }); }, accessor(n) { let held = "a"; Ob§ject.defineProperty(n, "rope", { get() { return { held }; }, set(v) { held = v; }, configurable: true, enumerable: true }); },
  above(n) { Ob§ject.setPrototypeOf(n, Ob§ject.assign(Ob§ject.create(Ob§ject.getPrototypeOf(n)), { lit: 7 })); }, missing(n) { n.rope = undefined; n.moored = null; }, extra(n) { n.extra = 1; n[0] = 2; }, thrown(n) { throw new RangeError("thrown"); },
})`.split("§").join(globalThis.nothing ?? ""));
for (const [name, fate] of Object.entries(fates)) {
  let count = 0;
  globalThis.watch = (craft) => { if (++count % 3 === 2) fate(craft); };
  out.push(name, show(() => walk(new Harbor("a{bc{d}}e").drift(), 0)));
  for (const make of [() => new Float({ a: 1 }), () => new Boat({ b: 2 }), () => new Raft({ moored: 5 }), () => Reflect.construct(Float, [{}], Boat), () => new (class extends Boat { constructor() { super({}); delete this.tint; } })()]) { const line = []; for (let i = 0; i < 3; i++) line.push(show(() => { const craft = make(); return craft.text() + (craft.heft ? show(() => craft.heft()) : "") + craft.lit + craft.tint; })); out.push(line.join(" ")); }
  globalThis.watch = null;
}
for (const line of out) console.log(line);
