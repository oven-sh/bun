// An instance of a class is laid below another object by Object.setPrototypeOf, in front of an `instanceof` test and between two of them.
class Leaf { constructor() { this.a = 1; } }
class Twig extends Leaf { constructor() { super(); this.b = 2; } }
class Stone { constructor() { this.c = 3; } }
function isLeaf(x) { return x instanceof Leaf; }
function twice(x, above) { const before = x instanceof Leaf; Object.setPrototypeOf(x, above); return before + " " + (x instanceof Leaf); }
function movedTwigIsLeaf() { const twig = new Twig(); Object.setPrototypeOf(twig, null); return twig instanceof Leaf; }
function movedStoneIsLeaf() { const stone = new Stone(); Object.setPrototypeOf(stone, Leaf.prototype); return stone instanceof Leaf; }

function deed(x, above) {
  Object.setPrototypeOf(x, above);
  return x;
}
console.log(String(isLeaf(deed(new Leaf(), null))), String(isLeaf(deed(new Twig(), Stone.prototype))), String(isLeaf(deed(new Stone(), Leaf.prototype))), String(isLeaf(deed(new Twig(), Leaf.prototype))));
console.log(twice(new Leaf(), null), twice(new Stone(), Twig.prototype), twice(new Twig(), Twig.prototype), twice({}, Leaf.prototype));
console.log(String(movedTwigIsLeaf()), String(movedStoneIsLeaf()));
let count = 0;
for (let i = 0; i < 200; i++) count += (isLeaf(i % 3 ? new Twig() : deed(new Twig(), i % 2 ? Stone.prototype : null)) ? 1 : 0) + (movedTwigIsLeaf() ? 10 : 0) + (movedStoneIsLeaf() ? 100 : 0);
console.log(String(count));
const back = deed(new Leaf(), null);
console.log(String(isLeaf(back)), String(isLeaf(deed(back, Leaf.prototype))), String(isLeaf(deed(back, { __proto__: Twig.prototype }))));
const byName = new Twig();
byName.__proto__ = Stone.prototype;
console.log(String(isLeaf(byName)), String(byName instanceof Stone), String(isLeaf(new Twig())));
