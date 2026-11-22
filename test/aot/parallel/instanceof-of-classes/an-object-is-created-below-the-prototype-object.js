// Object.create lays an object below the prototype object of a class, without the constructor: it is an instance by `instanceof` and has none of the fields.
// Under: --aot-check=FlowFixpoint: the parameter of deed() meets prototype objects, null, Object.prototype and an instance: the fold of what meets lost the built-in without the mark that every other join sets, and the flow was not closed.
class Leaf { constructor() { this.a = 1; } get twice() { return this.a * 2; } }
class Twig extends Leaf { constructor() { super(); this.b = 2; } }
function isLeaf(x) { return x instanceof Leaf; }
function aOf(x) { return x instanceof Leaf ? x.a : "no leaf"; }
function createdIsLeaf() { const created = Object.create(Leaf.prototype); return created instanceof Leaf; }
function literalIsLeaf() { const literal = { __proto__: Twig.prototype, own: 1 }; return literal instanceof Leaf; }

function deed(above) {
  return Object.create(above);
}
console.log(String(isLeaf(deed(Leaf.prototype))), String(isLeaf(deed(Twig.prototype))), String(isLeaf(deed(null))), String(isLeaf(deed(Object.prototype))));
console.log(String(aOf(deed(Leaf.prototype))), String(aOf(new Leaf())), String(aOf(new Twig())), String(aOf(deed(new Twig()))), String(deed(Leaf.prototype).twice));
console.log(String(createdIsLeaf()), String(literalIsLeaf()));
let said = "";
for (let i = 0; i < 200; i++) said = String(aOf(i % 3 ? new Leaf() : deed(i % 2 ? Leaf.prototype : Object.prototype))) + createdIsLeaf() + literalIsLeaf();
console.log(said);
console.log(String(aOf({ __proto__: Leaf.prototype, a: "own" })), String(aOf({ __proto__: Twig.prototype })), String(isLeaf(Leaf.prototype)), String(isLeaf(Twig.prototype)));
