// Nothing is done to the classes: instances, instances of the class below and of another class are told apart by `instanceof`, without a call of the run time.
// COUNT: operation:operationAOTInstanceOfAndCache = 0
class Leaf { constructor(a) { this.a = a; } }
class Twig extends Leaf { constructor(a) { super(a); this.b = 2; } }
class Stone { constructor(c) { this.c = c; } }
function weigh(x) { return x instanceof Leaf ? x.a : x.c * 10; }

function deed(i) {
  return weigh(i % 3 === 0 ? new Leaf(i) : i % 3 === 1 ? new Twig(i) : new Stone(i));
}
console.log(String(deed(0)), String(deed(1)), String(deed(2)));
let sum = 0;
for (let i = 0; i < 3000; i++) sum += deed(i);
console.log(String(sum));
