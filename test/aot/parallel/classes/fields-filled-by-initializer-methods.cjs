// A method fills the fields of its object behind the constructor: objects before it, behind it, filled in part, twice, through heirs, frozen, with accessors, foreign.
"use strict";
let limit = -1, count = 0;
const pass = (v) => { if (++count === limit) throw new RangeError("stop"); return v; };
class Mark {
  constructor(i) { this.i = i; }
  begin(v) { this.at = pass(v); this.row = 1; this.sort = v > 2 ? "big" : "small"; this.value = pass(null); this.depth = 0.5; return this; }
  reset() { this.at = 0; this.row = 0; this.sort = "none"; this.value = undefined; }
  step() { ++this.at; this.row = this.at; return this.sort + this.row; }
  sum() { return this.at + this.row + this.depth; }
  early(v) { if (v === 9) return this; this.at = v; this.row = v; this.sort = v; this.value = v; return this; }
}
class Heir extends Mark { begin(v) { super.begin(v); this.late = v; return this; } get depth() { return 7; } set depth(v) { this.hidden = v; } }
class Lazy extends Mark { begin(v) { this.only = v; return this; } }
class Owner {
  constructor(s) { this.mark = s; }
  move() { this.mark.at = this.mark.at + 1; this.mark.row = this.mark.at; return this.mark.sort; }
  copy() { this.mark.value = this.mark.sort; this.mark.depth = this.mark.value; return this.mark.depth; }
  snapshot() { const s = this.mark; return [s.at, s.row, s.sort, s.value, s.depth].map(String).join(); }
  scan(n) { let w = 0; for (let k = 0; k < n; k++) { if (this.mark.at > 5) { this.mark.reset(); } else { ++this.mark.at; w += this.mark.row; } } return w + ":" + this.mark.at; }
}
globalThis.kept = [Mark, Owner, Heir, Lazy];
if (process.argv[9]) { new Mark(1)[process.argv[9]] = 2; new Owner()[process.argv[9]] = 3; }
const part = (s, n) => { limit = count + n; try { s.begin(3); } catch (e) { limit = -1; return s; } limit = -1; return s; };
const makers = {
  before: (i) => new Mark(i),
  behind: (i) => new Mark(i).begin(i),
  twice: (i) => new Mark(i).begin(i).begin(4),
  part: (i) => part(new Mark(i), i & 1 ? 1 : 2),
  early: (i) => new Mark(i).early(i & 1 ? 9 : i),
  reset: (i) => { const s = new Mark(i); s.reset(); return s; },
  mixed: (i) => (i & 1 ? new Mark(i) : new Mark(i).begin(i)),
  heir: (i) => new Heir(i).begin(i),
  lazy: (i) => new Lazy(i).begin(i),
  deleted: (i) => { const s = new Mark(i).begin(i); delete s.row; return s; },
  frozen: (i) => (i === 3 ? Object.freeze(new Mark(i).begin(i)) : new Mark(i).begin(i)),
  accessor: (i) => Object.defineProperty(new Mark(i).begin(i), "row", { get() { return "L" + this.i; }, set(v) { this.through = v; }, configurable: true, enumerable: true }),
  readOnly: (i) => Object.defineProperty(new Mark(i).begin(i), "at", { value: 3, writable: false, configurable: true, enumerable: true }),
  literal: (i) => ({ i, at: 1, row: 2, sort: "l", value: 3, depth: 4, reset: Mark.prototype.reset }),
  foreign: (i) => { const s = Object.create(Mark.prototype); Mark.prototype.begin.call(s, i); return s; },
  proxy: (i) => new Proxy(new Mark(i).begin(i), {}),
  none: (i) => (i === 4 ? undefined : new Mark(i).begin(i)),
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
        try { s += o.mark.step() + o.mark.sum() + " "; } catch (e) { s += e.constructor.name + " "; }
      }
    }
    for (const o of owners) { try { s += Object.keys(o.mark).join() + ";"; } catch (e) { s += e.constructor.name + ";"; } }
    out.push(title + " " + maker + " " + s);
  }
}
every("plain");
Mark.prototype.row = "above";
every("above");
delete Mark.prototype.row;
Object.defineProperty(Mark.prototype, "value", { get() { return "got" + this.i; }, set(v) { this.through = v; }, configurable: true });
every("setter");
delete Mark.prototype.value;
Object.defineProperty(Mark.prototype, "depth", { value: 1, writable: false, configurable: true });
every("readOnlyAbove");
delete Mark.prototype.depth;
every("again");
for (const line of out) console.log(line.slice(0, 400), line.length, [...line].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
