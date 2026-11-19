// Statements that read one slot twice (this.state.a = this.state.b) while the slot, the object in it and its fields are there, missing, accessors, frozen, replaced and of other classes.
"use strict";
const out = [];
class State { init(p) { this.pos = this.start = p; this.end = 0; this.type = "t"; this.loc = null; this.flag = false; return this; } at() { return { pos: this.pos, start: this.start }; } late(v) { this.added = v; } }
class Other { constructor() { this.pos = 1; this.start = 2; this.end = 3; this.type = "o"; this.loc = 4; this.flag = 5; } }
class Scanner {
  constructor(p) { this.state = new State().init(p); this.count = 0; }
  copy() { this.state.end = this.state.start; this.state.start = this.state.pos; this.state.loc = this.state.type; }
  step(n) { this.state.start = this.state.pos; this.state.pos += n; this.state.end = this.state.pos; ++this.count; return this.state.end - this.state.start; }
  swap() { const old = this.state.start; this.state.start = this.state.end; this.state.end = old; }
  self() { this.state.loc = this.state; return this.state.loc === this.state; }
  chain() { this.state.start = this.state.end = this.state.pos; this.state.flag = !this.state.flag; }
  calls() { this.state.loc = this.state.at(); this.state.type = this.state.type + this.state.pos; }
  added() { this.state.added = this.state.added; this.state.more = this.state.pos; }
  reads() { return [this.state.pos, this.state.start, this.state.end, this.state.type, this.state.loc, this.state.flag].map((v) => (v && typeof v === "object" ? Object.keys(v).join() : String(v))).join("|"); }
}
globalThis.kept = [State, Scanner, Other];
const ways = ["copy", "step", "swap", "self", "chain", "calls", "added"];
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message.slice(0, 40); } out.push(name + " " + String(r)); };
function every(name, make) {
  for (const way of ways) {
    let s;
    show(name + " made " + way, () => { s = make(); return "ok"; });
    if (!s) continue;
    show(name + " " + way, () => Scanner.prototype[way].call(s, 2));
    show(name + " again " + way, () => Scanner.prototype[way].call(s, 1.5));
    show(name + " read " + way, () => Scanner.prototype.reads.call(s));
    show(name + " keys " + way, () => Object.keys(s.state || {}).join());
  }
}
every("plain", () => new Scanner(3));
every("empty", () => { const s = new Scanner(1); s.state = new State(); return s; });
every("other", () => { const s = new Scanner(1); s.state = new Other(); return s; });
every("record", () => { const s = new Scanner(1); s.state = { pos: 1, start: 2 }; return s; });
every("missing", () => { const s = new Scanner(1); delete s.state; return s; });
every("null", () => { const s = new Scanner(1); s.state = null; return s; });
every("number", () => { const s = new Scanner(1); s.state = 7; return s; });
every("text", () => { const s = new Scanner(1); s.state = "some"; return s; });
every("frozen", () => { const s = new Scanner(4); Object.freeze(s.state); return s; });
every("sealed", () => { const s = new Scanner(4); Object.seal(s.state); return s; });
every("read-only", () => { const s = new Scanner(4); Object.defineProperty(s.state, "start", { value: 9, writable: false }); return s; });
every("getter", () => { const s = new Scanner(4); let n = 0; const a = s.state, b = new State().init(50); Object.defineProperty(s, "state", { get() { return n++ & 1 ? a : b; }, configurable: true }); return s; });
every("getter of two classes", () => { const s = new Scanner(4); let n = 0; const a = s.state, b = new Other(); Object.defineProperty(s, "state", { get() { return n++ % 3 ? a : b; }, configurable: true }); return s; });
every("field replaces", () => { const s = new Scanner(4); const a = s.state; Object.defineProperty(a, "pos", { get() { s.state = new State().init(70); return 5; }, set(v) { this.got = v; }, configurable: true }); return s; });
every("field throws", () => { const s = new Scanner(4); Object.defineProperty(s.state, "start", { get() { throw new Error("start"); }, configurable: true }); return s; });
every("setter", () => { const s = new Scanner(4); Object.defineProperty(s.state, "end", { get() { return 8; }, set(v) { s.state = null; }, configurable: true }); return s; });
every("proxy", () => { const s = new Scanner(4); const log = []; s.state = new Proxy(s.state, { get(t, k) { log.push("g" + String(k)); return t[k]; }, set(t, k, v) { log.push("s" + String(k)); t[k] = v; return true; } }); s.log = log; return s; });
every("text in field", () => { const s = new Scanner(4); s.state.pos = "x"; s.state.end = undefined; return s; });
every("deleted field", () => { const s = new Scanner(4); delete s.state.start; delete s.state.loc; return s; });
every("bigint", () => { const s = new Scanner(4); s.state.pos = 3n; return s; });
every("foreign", () => ({ state: { pos: 2, start: 1, at() { return 5; } }, count: 1 }));
every("heir", () => { class Deep extends Scanner { get own() { return 1; } } return new Deep(6); });
every("heir of state", () => { class Deeper extends State { get type() { return "d"; } set type(v) { this.seen = v; } } const s = new Scanner(1); s.state = new Deeper().init(2); return s; });
Object.defineProperty(State.prototype, "end", { get() { return "above"; }, set(v) { this.above = v; }, configurable: true });
every("accessor above", () => { const s = new Scanner(4); s.state = new State(); s.state.pos = 1; s.state.start = 2; return s; });
delete State.prototype.end;
State.prototype.start = 11; every("inherited", () => { const s = new Scanner(4); s.state = new State(); s.state.pos = 1; return s; }); delete State.prototype.start;
const many = new Scanner(0); let sum = 0; for (let i = 0; i < 300; i++) { many.copy(); sum += many.step(i % 3); many.swap(); many.chain(); if (i === 200) many.state = new Other(); if (i === 250) many.state = new State().init(1); }
show("many", () => [sum, many.reads(), many.count]);
for (const line of out) console.log(line);
