// Objects whose prototype changes out of sight: after their birth, in the midst of it, by another new.target, and back. Methods, fields and stores of known classes ask one compare of the cell.
// STATISTIC: PrototypesKnownByMarks >= 20
"use strict";
const out = [];
const hidden = (0, eval)("({ set(o, p) { return Object.setPrototypeOf(o, p) }, cre(p) { return Object.create(p) }, ass(o, p) { return Object.assign(o, p) }, pass(o) { return o }, replace(f, p) { f.prototype = p }, heir(B, m) { class H extends B {} Object.assign(H.prototype, m); return H }, build(f, a, t) { return Reflect.construct(f, a, t) }, below(o, names) { const p = Object.create(Object.getPrototypeOf(o)); for (const n in names) p[n] = names[n]; return Object.setPrototypeOf(o, p) } })");
globalThis.hidden = hidden;
const build = hidden.build;
let during = null;
class Cursor {
  constructor(text) { this.text = text; this.at = 0; this.depth = 0; if (during) during(this); this.last = ""; this.seen = 0; }
  more() { return this.at < this.text.length; }
  take() { this.last = this.text[this.at]; this.at++; this.seen += this.weight(); return this.last; }
  weight() { return this.depth + 1; }
  all() { let joined = ""; while (this.more()) { joined += this.take(); if (this.last === "!") this.change(); } return joined + this.seen + this.name(); }
  change() { this.depth++; }
  name() { return "cursor"; }
  get label() { return this.name() + this.at; }
}
class Wide extends Cursor { constructor(text) { super(text); this.extra = 5; } weight() { return 10 + this.extra; } name() { return "wide" + super.name(); } }
const other = { weight() { return 100; }, name() { return "other"; }, more() { return this.at < this.text.length; }, take() { this.at += 2; this.last = "!"; return "o"; }, change() { this.seen++; if (this.at > 6) hidden.set(this, Cursor.prototype); }, all: Cursor.prototype.all, label: "fixed" };
const heirOfNone = hidden.cre(null);
function run(cursor) { let text = ""; for (let i = 0; i < 2; i++) { cursor.at = 0; for (let j = 0; j < 2; j++) text += cursor.all() + "|" + cursor.label + "|"; } return text; }
function runAll(list) { const all = []; for (const each of list) all.push(show(() => run(each))); return all; }
for (const each of [Cursor, Wide, run, runAll, other]) globalThis["kept" + (each.name || "other")] = each;
const show = f => { try { return String(f()); } catch (error) { return error.constructor.name; } };
class Counter {
  constructor(hook) { this.first = 1; this.second = 2; this.list = [1, 2, 3]; this.hook = hook; this.last = 0; }
  step() { return 1; }
  more(by) { return by + this.step(); }
  run(turns) {
    let sum = 0;
    for (let turn = 0; turn < turns; turn++) {
      this.second = this.list.length + turn;
      this.first = this.second + this.last;
      sum += this.step() + this.more(turn);
      this.hook(this, turn);
      this.last = this.list[turn % 3];
      this.second = this.first + this.last;
      sum += this.step() * 10 + this.more(this.second);
      this.list = turn & 1 ? this.list : this.list.slice();
      this.hook(this, -turn);
      sum += this.second + this.first + this.step() * 100;
    }
    return sum;
  }
}
function Pair(left, right, act) { this.left = left; if (act) act(this); this.right = right; this.sum = left + right; }
Pair.prototype.total = function () { return this.left + this.right + this.weight(); };
Pair.prototype.weight = function () { return 1; };
function totals(pairs, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) for (const pair of pairs) { sum += pair.left * pair.right + pair.sum; sum += pair.total() + pair.weight(); pair.sum = sum & 15; } return sum; }
globalThis.keptToo = { Counter, Pair, totals };
const noop = () => {};
const names = { step() { return 7; }, weight() { return 50; }, more(by) { return by * 2; } };
out.push("counter " + new Counter(noop).run(9) + " " + new Counter((o, turn) => { if (turn === 3) hidden.below(o, names); }).run(9) + " " + new Counter((o, turn) => { if (turn === -4) hidden.set(o, { __proto__: Counter.prototype, step() { return 1000; } }); if (turn === 7) hidden.set(o, Counter.prototype); }).run(9));
out.push("born " + hidden.build(Counter, [noop], hidden.heir(Counter, { step() { return 30; } })).run(5) + " " + hidden.build(Counter, [noop], (0, eval)("(function () {})")).first + " " + show(() => hidden.build(Counter, [noop], Object).run));
const pairs = [new Pair(1, 2), new Pair(3, 4, o => hidden.below(o, names)), hidden.below(new Pair(5, 6), names), hidden.build(Pair, [7, 8], hidden.heir(Pair, { weight() { return 9; } })), new Pair(9, 10, o => { hidden.below(o, names); hidden.set(o, Pair.prototype); })];
out.push("pairs " + pairs.map(pair => totals([pair], 4)).join(" ") + " " + totals(pairs, 5) + " " + totals(pairs.slice(0, 1), 3));
for (let i = 0; i < 40; i++) { const pair = new Pair(i, i + 1); if (i % 5 === 2) hidden.below(pair, names); if (i % 5 === 3) { pair.added = i; hidden.below(pair, names); } out.push("pair " + totals([pair, pairs[i % 5]], 2)); }
function Late(left, right) { this.left = left; this.right = right; this.sum = left - right; }
Late.prototype.kind = function () { return this.left + 1; };
Late.prototype.size = function () { return this.kind() * 2; };
function sizes(lates, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) for (const late of lates) { sum += late.left * late.right + late.sum; sum += late.kind() + late.size(); late.sum = sum & 7; } return sum; }
function several(n) { const lates = []; for (let i = 0; i < n; i++) lates.push(new Late(i, i + 1)); return lates; }
function Early(left) { this.left = left; this.right = left + 1; this.sum = 0; }
Early.prototype.kind = function () { return 3; };
Early.prototype.size = function () { return this.left + this.kind(); };
globalThis.keptLast = { Late, Early, sizes, several };
hidden.replace(Early, { kind() { return 4000; }, size() { return this.right; } });
out.push("early " + sizes([new Early(1), new Early(2)], 3) + " " + sizes([new Early(3)], 2));
const firstLates = several(4);
out.push("late " + sizes(firstLates, 3));
hidden.replace(Late, { kind() { return 500; }, size() { return 7; } });
out.push("late " + sizes(several(4), 3) + " " + sizes(firstLates, 3) + " " + sizes([...several(2), ...firstLates], 4));
const below = { kind() { return 70; }, size() { return this.left; } };
function move(object, prototype) { return Object.setPrototypeOf(hidden.pass(object), hidden.pass(prototype)); }
function moves(lates, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) for (const late of lates) { sum += late.left + late.right; sum += late.kind(); if (turn & 1) hidden.pass(move)(late, below); sum += late.left * late.right + late.kind() + late.size(); } return sum; }
for (let i = 0; i < 6; i++) { const lates = several(3); out.push("moved " + moves(lates, 4) + " " + sizes(lates, 2)); for (const late of several(2)) { move(late, below); out.push("moved " + sizes([late], 2) + moves([late], 1)); } }
hidden.replace(Late, Object.getPrototypeOf(firstLates[0]));
out.push("late " + sizes(several(4), 3) + " " + sizes(firstLates, 3) + " " + moves(several(2), 5));
function Other() {}
Other.prototype = other;
const makers = [
  () => new Cursor("abc!def!g"), () => new Wide("ab!c"), () => hidden.set(new Cursor("abcdefgh"), other), () => hidden.set(new Wide("a!b!c"), Cursor.prototype), () => hidden.set(new Cursor("xyz"), Wide.prototype),
  () => build(Cursor, ["n!ew"], Other), () => build(Wide, ["he!ir"], Other), () => build(Cursor, ["cl!ass"], class extends Cursor { weight() { return 7; } }), () => build(Cursor, ["bound"], Wide),
  () => { during = made => hidden.set(made, other); try { return new Cursor("du!ring"); } finally { during = null; } },
  () => { during = made => { hidden.set(made, other); hidden.set(made, Cursor.prototype); }; try { return new Cursor("ba!ck"); } finally { during = null; } },
  () => { during = made => { made.late = 1; delete made.late; hidden.set(made, Wide.prototype); }; try { return new Wide("la!te"); } finally { during = null; } },
  () => hidden.set(new Cursor("null"), null), () => hidden.set(new Cursor("none"), heirOfNone), () => hidden.set(new Cursor("proxy!"), new Proxy(Cursor.prototype, { get: (o, k, r) => k === "weight" ? () => 1000 : Reflect.get(o, k, r) })),
  () => { const made = hidden.set(new Cursor("twice!!"), other); made.added = 1; return hidden.set(made, Cursor.prototype); }, () => { const made = new Cursor("own!"); made.weight = () => 33; return made; },
  () => { const made = new Cursor("un!filled"); delete made.last; return hidden.set(made, other); }, () => hidden.ass(hidden.set(new Cursor("copy!"), other), { at: 0, last: "z" }),
];
for (let round = 0; round < 30; round++) {
  const list = makers.map(make => make());
  for (const line of runAll(list)) if (round % 10 === 0 || round === 29) out.push(line);
  if (round === 10) for (const each of list) show(() => hidden.set(each, Wide.prototype)), round % 2 || out.push(...runAll([each]));
  if (round === 15) Cursor.prototype.weight = function () { return 2; };
  if (round === 20) hidden.set(Wide.prototype, other);
  if (round === 25) hidden.set(Cursor.prototype, { inherited: 1, late() { return "late"; } });
}
for (const line of out) console.log(line);
