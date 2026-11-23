// A method calls other methods of its object and reads its fields: one check of the object answers for its prototype, its fields and for freezing, until other code has run.
// STATISTIC: OwnMarksChecked >= 3
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
function Machine(tape, hook) { this.tape = tape; this.place = 0; this.depth = 0; this.hook = hook; this.seen = ""; }
Machine.prototype.top = function top() { return this.tape[this.place]; };
Machine.prototype.width = function width() { return this.tape.length - this.place + this.depth; };
Machine.prototype.note = function note(word) { this.seen += word; if (this.hook) this.hook(this, word); return this.seen.length; };
Machine.prototype.move = function move(step) { const before = this.top(); this.place += step; this.note(before); this.depth = this.width(); if (this.top() === undefined) this.place = 0; return this.depth; };
Machine.prototype.run = function run(steps) { let sum = 0; for (let i = 0; i < steps; i++) { sum += this.move(1) + this.width(); if (this.top() === "c") { this.depth += 1; this.note("!"); } } return sum + this.seen; };
Machine.prototype.nested = function nested(level) { if (level === 0) return this.width(); this.depth += 1; const inner = this.nested(level - 1) + this.width(); this.depth -= 1; return inner + this.note("n"); };
globalThis.outside = { Machine, machine: new Machine(["x"], null), change(machine) { return machine; } };
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`({
  nothing() {}, deleted(m) { del§ete m.depth; }, deletedTape(m) { del§ete m.tape; }, frozen(m) { Ob§ject.freeze(m); }, sealed(m) { Ob§ject.seal(m); }, closed(m) { Ob§ject.preventExtensions(m); }, locked(m) { Ob§ject.defineProperty(m, "place", { writable: false }); },
  accessor(m) { let held = m.depth; Ob§ject.defineProperty(m, "depth", { get() { return held + 1; }, set(v) { held = v; }, configurable: true, enumerable: true }); }, shadowed(m) { m.width = function () { return 100; }; }, shadowedTop(m) { Ob§ject.defineProperty(m, "top", { get() { return () => "g"; }, configurable: true }); },
  otherPrototype(m) { Ob§ject.setPrototypeOf(m, Ob§ject.assign(Ob§ject.create(Ob§ject.getPrototypeOf(m)), { width() { return 1000; } })); }, noPrototype(m) { Ob§ject.setPrototypeOf(m, null); }, text(m) { m.depth = "t"; }, missing(m) { m.seen = undefined; }, extra(m) { m.extra = 1; m[5] = 6; },
  proxied(m) { m.tape = new Proxy(m.tape, { get(target, key) { return key === "length" ? 50 : target[key]; } }); },
})`.split("§").join(globalThis.nothing ?? ""));
for (const [name, fate] of Object.entries(fates)) {
  for (const when of ["before", "b", "n"]) {
    let left = 1;
    const machine = globalThis.outside.change(new Machine(["a", "b", "c", "d"], when === "before" ? null : (m, word) => { if (word === when && left) { left = 0; fate(m); } }));
    if (when === "before") fate(machine);
    out.push([name, when, show(() => machine.run(6)), show(() => machine.nested(3)), show(() => machine.move(2)), Object.getOwnPropertyNames(machine).filter((n) => n !== "hook").join(), show(() => [machine.place, machine.depth, machine.seen])].join(" "));
  }
}
// Methods that are replaced while others run.
{
  const machine = globalThis.outside.change(new Machine(["a", "b", "c"], (m, word) => { if (word === "b") Machine.prototype.width = function () { return 7; }; if (word === "c") delete Machine.prototype.top; }));
  out.push(show(() => machine.run(2)), show(() => machine.run(3)), show(() => machine.nested(2)));
  Machine.prototype.top = function () { return "z"; };
  out.push(show(() => machine.run(2)), show(() => new Machine(["q", "r"], null).run(3)));
}
for (const line of out) console.log(line);
