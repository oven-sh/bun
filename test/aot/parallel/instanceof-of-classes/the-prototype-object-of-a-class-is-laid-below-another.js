// The prototype object of a class is laid below another object, so that the instances of the class and of those below it leave the class that is written above them.
class Leaf { constructor() { this.a = 1; } }
class Twig extends Leaf { constructor() { super(); this.b = 2; } }
class Bud extends Twig { constructor() { super(); this.d = 4; } }
class Stone { constructor() { this.c = 3; } }
function isLeaf(x) { return x instanceof Leaf; }
function isStone(x) { return x instanceof Stone; }
function tellOf(x) { return isLeaf(x) + "," + isStone(x) + "," + (x instanceof Twig); }

function deed(above) {
  Object.setPrototypeOf(Twig.prototype, above);
}
const twig = new Twig(), bud = new Bud(), leaf = new Leaf();
console.log(tellOf(twig), tellOf(bud), tellOf(leaf));
let count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i & 1 ? twig : bud) ? 1 : 0;
console.log(String(count));
deed(Stone.prototype);
console.log(tellOf(twig), tellOf(bud), tellOf(leaf), tellOf(new Twig()), tellOf(new Bud()));
count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i % 3 ? twig : leaf) ? 1 : 0;
console.log(String(count));
deed(Leaf.prototype);
console.log(tellOf(twig), tellOf(bud), tellOf(new Bud()));
