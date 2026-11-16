// Fields that a method stores and no constructor: they are read and stored outside of loops while they are missing, there, deleted, accessors, read-only and inherited.
"use strict";
const out = [];
class State {
  init(input) { this.input = input; this.pos = this.start = 0; this.type = null; this.flag = false; return this; }
  late(v) { this.added = v; return this; }
  clone() { const s = new State(); for (const k in this) s[k] = this[k]; return s; }
}
class Scanner {
  constructor(input) { this.state = new State().init(input); }
  next() { if (!this.ahead) this.count = (this.count || 0) + 1; this.state.start = this.state.pos; this.state.pos += 2; this.state.type = this.state.pos & 1 ? "odd" : this.state.pos; return this.state.pos; }
  is(type) { return this.state.type === type; }
  added() { return this.state.added; }
  look() { const old = this.state; this.state = old.clone(); this.ahead = true; this.next(); this.ahead = false; const seen = this.state; this.state = old; return seen; }
  set(k, v) { this.state[k] = v; }
}
globalThis.kept = [State, Scanner];
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message.slice(0, 30); } out.push(name + " " + String(r)); };
const s = new Scanner("some text");
show("empty", () => [new State().pos, new State().added, "pos" in new State(), Object.keys(new State())]);
for (let i = 0; i < 3; i++) { show("next", () => s.next()); show("is", () => s.is(4) + "" + s.is("odd") + s.is(null)); show("added", () => s.added()); show("look", () => Object.keys(s.look()).join() + s.look().pos); }
s.state.late(5); show("late", () => [s.added(), Object.keys(s.state).join(), s.look().added]);
delete s.state.pos; show("deleted", () => [s.next(), s.state.pos, Object.keys(s.state).join()]);
s.set("pos", "text"); show("text", () => [s.next(), s.state.pos]);
s.set("pos", 1.5); show("fraction", () => [s.next(), s.is(3.5)]);
Object.defineProperty(s.state, "pos", { get() { return 40; }, set(v) { this.got = v; }, configurable: true }); show("accessor", () => [s.next(), s.state.got, s.look().pos]);
Object.defineProperty(s.state, "pos", { value: 7, writable: false, configurable: true, enumerable: true }); show("read-only", () => s.next()); show("still", () => s.state.pos);
delete s.state.pos;
Object.defineProperty(State.prototype, "added", { get() { return "above"; }, configurable: true }); show("getter above", () => [s.added(), new Scanner("x").added(), delete s.state.added, s.added()]); delete State.prototype.added;
Object.defineProperty(State.prototype, "start", { set(v) { this.through = v; }, get() { return "up"; }, configurable: true }); const t = Object.assign(Object.create(Scanner.prototype), { state: new State() }); show("setter above", () => [t.next(), t.state.through, Object.keys(t.state).join()]); delete State.prototype.start;
State.prototype.pos = 100; const u = Object.assign(Object.create(Scanner.prototype), { state: new State() }); show("inherited", () => [u.next(), u.state.pos, Object.keys(u.state).join()]); delete State.prototype.pos;
Object.freeze(s.state); show("frozen", () => s.next()); show("frozen still", () => Object.keys(s.state).join());
Object.setPrototypeOf(u.state, { pos: 3, get type() { return "t"; } }); delete u.state.pos; show("moved", () => [u.next(), u.is("t"), u.state.pos]);
show("foreign", () => [Scanner.prototype.next.call({ state: { pos: 1 } }), Scanner.prototype.is.call({ state: "s" }, undefined), Scanner.prototype.is.call({ state: null })]);
for (const line of out) console.log(line);
