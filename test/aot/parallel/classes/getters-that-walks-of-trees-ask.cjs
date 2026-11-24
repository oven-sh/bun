// STATISTIC: GettersCalledByClass >= 2
// A tree of seven classes is walked: the getter is asked in front of the loop and in each turn, each time by class.
"use strict";
const R = globalThis[JSON.parse('"Reflect"')], unseen = JSON.parse("{}"), slip = (g, x) => R.apply(R.get(unseen, "push"), g.members, [x]);
let reads = 0;
const nothing = [];
class Piece { constructor(id) { this.id = id; this.owner = null; } }
class Group extends Piece { constructor(id) { super(id); this.members = []; } get below() { reads++; return this.members; } take(p) { p.owner = this; this.members.push(p); return this; } }
class Part extends Piece { get below() { return nothing; } }
class Book extends Group {}
class Chapter extends Group { constructor(id) { super(id); this.number = id % 9; } }
class Section extends Group { constructor(id) { super(id); this.title = "s" + id % 5; } }
class Verse extends Part { constructor(id) { super(id); this.lines = id % 6; } }
class Note extends Part { constructor(id) { super(id); this.mark = "*"; this.lines = 1; } }
class Break extends Part {}
class Table extends Part { constructor(id) { super(id); this.rows = 2; this.columns = 3; } }
function depth(p) { if (!p.below.length) return 1; let most = 0; for (let i = 0; i < p.below.length; i++) { const d = depth(p.below[i]); if (d > most) most = d; } return most + 1; }
function sum(p, n) { n = (n * 31 + p.id) | 0; for (let i = 0; i < p.below.length; i++) n = sum(p.below[i], n); return n; }
function lines(p) { let n = p.lines === undefined ? 0 : p.lines; for (let i = 0; i < p.below.length; i++) n += lines(p.below[i]); return n; }
function find(p, id) { if (p.id === id) return 1; const list = p.below; let n = 1; for (let i = 0; i < list.length; i++) { n += find(list[i], id); if (n > 200) return n; } return n; }
function widest(p) { let most = p.below.length; for (let i = 0; i < p.below.length; i++) most = Math.max(most, widest(p.below[i])); return most; }
let next = 0;
function grow(levels, wide) {
  const id = next++, kind = id % 4;
  if (!levels) return kind === 0 ? new Verse(id) : kind === 1 ? new Note(id) : kind === 2 ? new Break(id) : new Table(id);
  const g = levels > 3 ? new Book(id) : kind < 2 ? new Chapter(id) : new Section(id);
  for (let i = 0; i < wide; i++) g.take(grow(i % 3 ? levels - 1 : 0, wide));
  return g;
}
for (let k = 0; k < 4; k++) { const t = grow(4, 3 + k % 2); let n = 0; for (let i = 0; i < 6; i++) n = sum(t, n); console.log(depth(t), n, lines(t), find(t, 9), widest(t), reads); }
R.set(unseen, "push", [].push);
const t = grow(3, 4); console.log(depth(t), lines(t), find(t, -1), widest(t));
Object.defineProperty(Verse.prototype, "below", { get() { return this.owner && this.lines > 3 ? [new Break(1)] : nothing; }, configurable: true }); console.log(depth(t), sum(t, 1), lines(t));
R.defineProperty(t.members[0], JSON.parse('"below"'), { value: [new Note(5)], configurable: true }); console.log(depth(t), sum(t, 1), lines(t), reads);
delete Verse.prototype.below; console.log(depth(t), sum(t, 1), lines(t));
slip(t, JSON.parse('{"id":7,"below":[],"lines":2}')); console.log(depth(t), sum(t, 1), lines(t));
slip(t, JSON.parse('{"id":8}')); for (const f of [depth, t => sum(t, 0), lines]) try { console.log(f(t)); } catch (e) { console.log(e.constructor.name); }
