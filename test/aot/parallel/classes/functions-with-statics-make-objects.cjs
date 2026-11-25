// COUNTER: CreateThisSlowPaths <= 400
// Constructor functions that carry properties of their own make objects in loops: what each of them allocates is remembered until its prototype, or what its prototype lies below, is another one.
"use strict";
function plants() {
  function Plant(n) { this.height = n; Plant.made++; }
  function Tree(n) { Plant.call(this, n); this.rings = n; Tree.made++; }
  function Pear(n) { Tree.call(this, n); this.fruit = n; Pear.made++; }
  function Moss(n) { Plant.call(this, n); this.spread = n; Moss.made++; }
  for (const each of [Plant, Tree, Pear, Moss]) each.made = 0;
  Plant.roots = 3; Tree.roots = 9; Tree.shade = true; Moss.roots = 0; Pear.above = Tree;
  Object.setPrototypeOf(Tree.prototype, Plant.prototype); Object.setPrototypeOf(Pear.prototype, Tree.prototype); Object.setPrototypeOf(Moss.prototype, Plant.prototype);
  Plant.prototype.told = function () { return "plant " + this.height; };
  Tree.prototype.told = function () { return "tree " + this.height + "/" + this.rings; };
  Pear.prototype.eaten = function () { return --this.fruit; };
  Moss.prototype.cover = function (n) { return this.spread * n; };
  return { Plant, Tree, Pear, Moss };
}
const { Plant, Tree, Pear, Moss } = plants();
function grown(kind, count) { let sum = 0; for (let i = 0; i < count; i++) { const each = new kind(i); sum += each.height + (each.rings || 0) + (each.fruit || 0); } return sum; }
let total = 0;
for (let turn = 0; turn < 30; turn++) total += grown(Plant, 100) + grown(Tree, 100) + grown(Pear, 100) + grown(Moss, 100);
console.log(total, Plant.made, Tree.made, Pear.made, Moss.made, new Pear(4).told(), new Pear(4).eaten(), Moss.roots + Tree.roots, Pear.above === Tree);
// Another prototype from here on: what is made lies below it, what was made does not.
const before = new Pear(2), first = Pear.prototype;
Pear.prototype = { told: () => "changed", __proto__: Plant.prototype };
console.log(new Pear(1).told(), before.told(), new Pear(1) instanceof Tree, before instanceof Pear, grown(Pear, 50));
Pear.prototype = first; console.log(new Pear(3).told(), before instanceof Pear, grown(Pear, 50));
// The prototype stays, what it lies below changes.
Object.setPrototypeOf(Moss.prototype, Tree.prototype); console.log(new Moss(1).told(), grown(Moss, 50), new Moss(1) instanceof Tree);
Object.setPrototypeOf(Moss.prototype, null); const bare = new Moss(6); console.log(Object.getPrototypeOf(Object.getPrototypeOf(bare)), bare.cover(2), grown(Moss, 50));
Object.setPrototypeOf(Moss.prototype, Plant.prototype); console.log(new Moss(1).told());
// A prototype that is no object, one that a getter answers, a target of its own, a bound one, a proxy.
for (const odd of [5, null, undefined, "text"]) { Tree.prototype = odd; console.log(Object.getPrototypeOf(new Tree(1)) === Object.prototype, grown(Tree, 20)); }
const Other = function () {}; Other.prototype = Moss.prototype;
console.log(Reflect.construct(Plant, [3], Other) instanceof Moss, Reflect.construct(Plant, [3], Moss).told(), new (Plant.bind(null, 8))().height, new (new Proxy(Plant, {}))(9).told());
let asked = 0; const watched = new Proxy(Plant, { get(target, key) { if (key === "prototype") asked++; return Reflect.get(target, key); } });
for (let i = 0; i < 5; i++) new watched(i); console.log(asked, Plant.made);
