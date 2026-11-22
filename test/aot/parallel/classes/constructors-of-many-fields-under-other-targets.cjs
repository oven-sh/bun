'use strict';
// Constructors of many fields, called by functions that turns of nested loops call: by new, by an heir, by Reflect.construct with another new.target, whose prototype is an object, a primitive or a getter that throws.
class Record {
  constructor(id, kind, from, to) {
    this.id = id; this.kind = kind; this.from = from; this.to = to; this.next = null; this.notes = undefined; this.weight = from * .5; this.isOpen = from < to; this.depth = 0; this.tag = kind + id; this.list = [id]; this.extra = null;
    if (kind === 'row') { this.depth = 1; this.extra = { id }; } else if (kind === 'cell') { this.depth = 2; this.notes = 'in a cell'; }
    for (let i = from; i < to; i++) this.list.push(i);
    this.target = new.target === undefined ? 'none' : new.target.name;
  }
  span() { return this.to - this.from + this.depth; }
}
class Wide extends Record { constructor(id, from) { super(id, 'row', from, from + 3); this.wide = true; } span() { return super.span() * 10; } }
function Old(id) { if (!new.target) return new Old(id); this.id = id; this.kind = 'old'; this.from = id; this.to = id + 1; this.a = 1; this.b = 2; this.c = 3; this.d = 4; this.e = 5; this.f = 6; this.depth = 3; this.list = [id]; }
Old.prototype.span = function () { return this.depth; };
let asked = 0;
const other = { span() { return 'other'; } };
const targets = [Record, Wide, Object.assign(function () {}, {}), Object.assign(() => 1, {}), function () {}.bind(), new Proxy(function () {}, { get(t, k, r) { asked++; return k === 'prototype' ? other : Reflect.get(t, k, r); } })];
const last = function () {}; last.prototype = 7; targets.push(last);
const show = f => { try { return String(f()); } catch (e) { return e.constructor.name + (/getter/.test(e.message) ? ' getter' : ''); } };
const makeRow = (i, j) => new Record(i, 'row', j, j + i % 4);
const makeCell = (i, j) => new Record(i, 'cell', i, j);
function table(n) { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { const r = makeRow(i, j), c = makeCell(i, j), w = j & 1 ? new Wide(i, j) : Old(i); s = s * 7 + r.span() * 3 + c.span() + w.span() + r.list.length | 0; } } return s; }
for (let k = 0; k < 5; k++) console.log(k, table(9 + k));
targets.forEach((t, i) => console.log(i, show(() => { const r = Reflect.construct(Record, [i, 'row', 1, 4], t); return [r.tag, r.target, typeof r.span, r.span ? r.span() : 'no', r.list, r instanceof Record]; }), show(() => { const r = Reflect.construct(Old, [i], t); return [r.kind, r.span ? r.span() : 'no']; })));
const throws = new Proxy(class {}, { get(t, k) { if (k === 'prototype') throw new RangeError('a getter'); return t[k]; } });
console.log(show(() => Reflect.construct(Record, [1, 'cell', 2, 3], throws)), show(() => Record(1)), asked > 0, table(5));
