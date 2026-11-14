// Objects are born without a field, and a method fills them: objects before it, behind it, filled in part, twice, through heirs, frozen, with accessors, foreign.
"use strict";
let limit = -1, count = 0;
const pass = (v) => { if (++count === limit) throw new RangeError("stop"); return v; };
class State {
  init(v) { this.pos = pass(v); this.line = 1; this.type = v > 2 ? "big" : "small"; this.value = pass(null); this.depth = 0.5; return this; }
  reset() { this.pos = 0; this.line = 0; this.type = "none"; this.value = undefined; }
  step() { ++this.pos; this.line = this.pos; return this.type + this.line; }
  sum() { return this.pos + this.line + this.depth; }
  early(v) { if (v === 9) return this; this.pos = v; this.line = v; this.type = v; this.value = v; return this; }
}
class Heir extends State { init(v) { super.init(v); this.late = v; return this; } get depth() { return 7; } set depth(v) { this.hidden = v; } }
class Lazy extends State { init(v) { this.only = v; return this; } }
class Owner {
  constructor(s) { this.state = s; }
  move() { this.state.pos = this.state.pos + 1; this.state.line = this.state.pos; return this.state.type; }
  copy() { this.state.value = this.state.type; this.state.depth = this.state.value; return this.state.depth; }
  snapshot() { const s = this.state; return [s.pos, s.line, s.type, s.value, s.depth].map(String).join(); }
  scan(n) { let w = 0; for (let k = 0; k < n; k++) { if (this.state.pos > 5) { this.state.reset(); } else { ++this.state.pos; w += this.state.line; } } return w + ":" + this.state.pos; }
}
globalThis.kept = [State, Owner, Heir, Lazy];
if (process.argv[9]) { new State(1)[process.argv[9]] = 2; new Owner()[process.argv[9]] = 3; }
const part = (s, n) => { limit = count + n; try { s.init(3); } catch (e) { limit = -1; return s; } limit = -1; return s; };
const makers = {
  before: (i) => new State(i),
  behind: (i) => new State(i).init(i),
  twice: (i) => new State(i).init(i).init(4),
  part: (i) => part(new State(i), i & 1 ? 1 : 2),
  early: (i) => new State(i).early(i & 1 ? 9 : i),
  reset: (i) => { const s = new State(i); s.reset(); return s; },
  mixed: (i) => (i & 1 ? new State(i) : new State(i).init(i)),
  heir: (i) => new Heir(i).init(i),
  lazy: (i) => new Lazy(i).init(i),
  deleted: (i) => { const s = new State(i).init(i); delete s.line; return s; },
  frozen: (i) => (i === 3 ? Object.freeze(new State(i).init(i)) : new State(i).init(i)),
  accessor: (i) => Object.defineProperty(new State(i).init(i), "line", { get() { return "L" + this.i; }, set(v) { this.through = v; }, configurable: true, enumerable: true }),
  readOnly: (i) => Object.defineProperty(new State(i).init(i), "pos", { value: 3, writable: false, configurable: true, enumerable: true }),
  literal: (i) => ({ i, pos: 1, line: 2, type: "l", value: 3, depth: 4, reset: State.prototype.reset }),
  foreign: (i) => { const s = Object.create(State.prototype); State.prototype.init.call(s, i); return s; },
  proxy: (i) => new Proxy(new State(i).init(i), {}),
  none: (i) => (i === 4 ? undefined : new State(i).init(i)),
};
const out = [];
function every(title) {
  for (const maker of Object.keys(makers)) {
    const owners = [];
    let s = "";
    for (let i = 0; i < 6; i++) { try { owners.push(new Owner(makers[maker](i))); } catch (e) { s += e.constructor.name + " "; } }
    for (let turn = 0; turn < 3; turn++) {
      for (let i = 0; i < owners.length; i++) {
        const o = owners[i];
        try { s += o.move() + o.copy() + o.scan(4) + "|" + o.snapshot() + "|"; } catch (e) { s += e.constructor.name; }
        try { s += o.state.step() + o.state.sum() + " "; } catch (e) { s += e.constructor.name + " "; }
      }
    }
    for (const o of owners) { try { s += Object.keys(o.state).join() + ";"; } catch (e) { s += e.constructor.name + ";"; } }
    out.push(title + " " + maker + " " + s);
  }
}
every("plain");
State.prototype.line = "above";
every("above");
delete State.prototype.line;
Object.defineProperty(State.prototype, "value", { get() { return "got" + this.i; }, set(v) { this.through = v; }, configurable: true });
every("setter");
delete State.prototype.value;
Object.defineProperty(State.prototype, "depth", { value: 1, writable: false, configurable: true });
every("readOnlyAbove");
delete State.prototype.depth;
every("again");
for (const line of out) console.log(line.slice(0, 400), line.length, [...line].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
