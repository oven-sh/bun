// Loops that store under names which only stores declare, into objects that lack the name, have it, are frozen, inherit a setter or come from elsewhere.
"use strict";
class Row { constructor(i) { this.i = i; } set(m) { this.mark = m; } flag(f) { this.seen = f; } }
class Holder { constructor(row) { this.row = row; } }
const out = [];
globalThis.make = (i) => new Row(i);
globalThis.kept = [Row, Holder];
const loops = {
  fresh(n) { let s = 0; for (let i = 0; i < n; i++) { const r = globalThis.make(i); r.mark = i; s += r.i + (r.mark ?? 100); } return s; },
  two(n) { const keys = []; for (let i = 0; i < n; i++) { const r = globalThis.make(i); r.mark = i; r.seen = true; keys.push(Object.keys(r).join()); } return keys.join(" "); },
  held(n) { const keys = []; for (let i = 0; i < n; i++) { const h = new Holder(globalThis.make(i)); h.row.seen = i; h.row.mark = h.row.seen; keys.push(Object.keys(h.row).join() + h.row.mark); } return keys.join(" "); },
  over(n) { const r = globalThis.make(0); let s = ""; for (let i = 0; i < n; i++) { r.mark = i; s += r.mark; } return s + Object.keys(r); },
  counted(n) { const r = globalThis.make(0); for (let i = 0; i < n; i++) { r.mark = (r.mark || 0) + 1; r.seen = r.mark; } return r.mark + Object.keys(r).join(); },
  mixed(n) { let s = ""; for (let i = 0; i < n; i++) { const r = globalThis.make(i); if (i & 1) r.set(5); r.mark = i; r.mark = r.mark; s += r.mark + Object.keys(r).length; } return s; },
};
const makers = {
  plain: (i) => new Row(i),
  filled: (i) => { const r = new Row(i); r.flag(0); r.set(1); return r; },
  frozen: (i) => (i === 3 ? Object.freeze(new Row(i)) : new Row(i)),
  other: (i) => (i & 1 ? { i, mark: 7 } : new Row(i)),
  heir: (i) => new (class Heir extends Row { get seen() { return "got"; } set seen(v) { this.hidden = v; } })(i),
  deleted: (i) => { const r = new Row(i); r.set(1); delete r.mark; return r; },
};
function every(name) {
  for (const way of Object.keys(loops)) {
    let s;
    try { s = loops[way](6); } catch (e) { s = e.constructor.name; }
    out.push(name + " " + way + " " + s);
  }
}
for (const name of Object.keys(makers)) { globalThis.make = makers[name]; every(name); }
globalThis.make = makers.plain;
Object.defineProperty(Row.prototype, "mark", { set(v) { this.kept = v; }, get() { return -1; }, configurable: true });
every("setter");
delete Row.prototype.mark;
Object.defineProperty(Row.prototype, "seen", { value: 1, writable: false, configurable: true });
every("locked");
for (const line of out) console.log(line);
