// Methods that loops call read and store several fields of the object that a slot of `this` holds. Only stores declare the fields: they are missing, there, deleted, frozen, accessors, inherited, or of another object.
"use strict";
class Data { constructor(i) { this.i = i; this.kids = null; } set(m) { this.mark = m; } flag(f) { this.seen = f; } more(v) { this.extra = v; } }
class Other { constructor() { this.i = "other"; this.mark = "m"; } }
class Heir extends Data { get seen() { return "got"; } set seen(v) { this.hidden = v; } }
class Owner {
  constructor(d) { this.data = d; this.n = 0; }
  one() { return this.data.i + (this.data.mark ? 1 : 0); }
  both() { const a = this.data.mark, b = this.data.seen; return a ? 1 : b ? 2 : 3; }
  three() { return [this.data.mark, this.data.seen, this.data.extra].map(String).join(); }
  first() { this.data.mark = 5; return this.data.i; }
  firstThree() { this.data.mark = this.data.i; this.data.seen = true; this.data.extra = this.data.i; return Object.keys(this.data).join(); }
  copy() { this.data.mark = this.data.seen; return this.data.mark; }
  own() { const d = this.data; d.mark = 5; d.seen = d.i; return d.extra ? 1 : 2; }
  swap() { const old = this.data.mark; this.data.mark = this.data.seen; this.data.seen = old; return this.data.mark + "," + this.data.seen; }
  last() { return this.data.kids === null ? this.data.extra : this.data.kids[this.data.kids.length - 1]; }
}
globalThis.kept = [Data, Other, Heir, Owner];
if (process.argv[9]) { new Data(1)[process.argv[9]] = 2; new Owner()[process.argv[9]] = 3; }
const out = [];
const full = (d) => { d.set(3); d.flag(true); d.more(7); return d; };
const makers = {
  empty: (i) => new Data(i),
  full: (i) => full(new Data(i)),
  reversed: (i) => { const d = new Data(i); d.more(1); d.flag(0); d.set("t"); return d; },
  half: (i) => { const d = new Data(i); if (i & 1) d.flag(i); return d; },
  deleted: (i) => { const d = full(new Data(i)); delete d.seen; return d; },
  lessBirth: (i) => { const d = full(new Data(i)); delete d.i; return d; },
  frozen: (i) => (i === 3 ? Object.freeze(full(new Data(i))) : new Data(i)),
  sealed: (i) => (i === 2 ? Object.seal(new Data(i)) : full(new Data(i))),
  accessor: (i) => Object.defineProperty(new Data(i), "seen", { get() { return "s" + this.i; }, set(v) { this.through = v; }, configurable: true, enumerable: true }),
  readOnly: (i) => Object.defineProperty(new Data(i), "mark", { value: 1, writable: false, configurable: true, enumerable: true }),
  heir: (i) => new Heir(i),
  other: (i) => (i & 1 ? new Other() : new Data(i)),
  literal: (i) => ({ i, mark: 2, kids: null }),
  none: (i) => (i === 4 ? null : new Data(i)),
  inherited: (i) => Object.setPrototypeOf(new Data(i), { mark: "above", seen: 4 }),
  proxy: (i) => new Proxy(new Data(i), {}),
  list: (i) => { const d = new Data(i); d.kids = [i, i + 1]; return d; },
};
const names = ["one", "both", "three", "first", "firstThree", "copy", "own", "swap", "last"];
function every(title) {
  for (const maker of Object.keys(makers)) {
    for (const name of names) {
      let s = "";
      const owners = [];
      for (let i = 0; i < 6; i++) { try { owners.push(new Owner(makers[maker](i))); } catch (e) { s += e.constructor.name + " "; } }
      for (let i = 0; i < owners.length; i++) {
        const o = owners[i];
        try {
          switch (name) {
            case "one": s += o.one(); break;
            case "both": s += o.both(); break;
            case "three": s += o.three(); break;
            case "first": s += o.first(); break;
            case "firstThree": s += o.firstThree(); break;
            case "copy": s += o.copy(); break;
            case "own": s += o.own(); break;
            case "swap": s += o.swap(); break;
            default: s += o.last();
          }
        } catch (e) { s += e.constructor.name; }
        s += " ";
      }
      for (let k = 0; k < 3; k++) for (const o of owners) { try { s += (name === "copy" ? o.copy() : o.three()) + ";"; } catch (e) { s += e.constructor.name + ";"; } }
      out.push(title + " " + maker + " " + name + " " + s);
    }
  }
}
every("plain");
Data.prototype.mark = "up";
every("above");
delete Data.prototype.mark;
Object.defineProperty(Data.prototype, "extra", { get() { return "got" + this.i; }, set(v) { this.through = v; }, configurable: true });
every("getter");
delete Data.prototype.extra;
Object.defineProperty(Data.prototype, "seen", { value: 1, writable: false, configurable: true });
every("readOnlyAbove");
delete Data.prototype.seen;
every("again");
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(out.length, hash);
for (let i = 0; i < out.length; i += 7) console.log(out[i]);
