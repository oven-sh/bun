'use strict';
// A function takes a class and gives back an heir that hides one method, which a statement has laid on the prototype of a constructor function. The other methods still answer for the instances of both, in loops and alone, also where one is laid anew later.
function Scale(limit) { this.limit = limit; this.load = 0; this.steps = 0; }
Scale.prototype.put = function (n) { this.load += this.weigh(n); this.steps++; return this.load >= this.limit; };
Scale.prototype.weigh = function (n) { return n * 2; };
Scale.prototype.label = function () { return 'scale ' + this.steps; };
Scale.prototype.empty = function () { const had = this.load; this.load = 0; return had; };
const coarser = Base => class Coarse extends Base { weigh(n) { return super.weigh(n) & ~3; } };
const marked = (Base, mark) => class extends Base { label() { return mark + super.label(); } };
const emptied = Base => class extends Base { empty() { return -super.empty(); } };
const Coarse = coarser(Scale), Marked = marked(Scale, '# '), Both = marked(coarser(Scale), '+ '), Third = emptied(Both);
const makers = [n => new Scale(n), n => new Coarse(n), n => new Marked(n), n => new Both(n), n => new Third(n)];
function fill(scale, from, to) { for (let i = from; i < to; i++) if (scale.put(i)) return i; return -1; }
function all(scales) { let n = 0; for (const s of scales) { n = n * 31 + fill(s, 1, 40) | 0; n += s.empty(); } return n; }
for (let round = 0; round < 6; round++) {
  const scales = makers.map((make, i) => make(30 + i * 7 + round));
  console.log(round, all(scales), scales.map(s => s.label() + ':' + s.load + ':' + s.weigh(5)).join(' | '));
  for (let k = 0; k < 300; k++) all([makers[k % 5](20)]);
  if (round === 2) Scale.prototype.weigh = function (n) { return n * 2 + .5; };
  if (round === 3) Coarse.prototype.weigh = function (n) { return -n; };
  if (round === 4) Marked.prototype.put = Scale.prototype.empty;
}
const alone = new Coarse(10); alone.weigh = n => n + 100;
console.log(fill(alone, 0, 5), alone.label(), Object.getPrototypeOf(Both.prototype).constructor.name, new Third(1) instanceof Scale);
