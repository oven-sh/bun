// A function that is constructed is given the prototype object of a class, or an object below it, as its `prototype`: what it makes is an instance of the class, though nothing is written between the two.
class Leaf { constructor() { this.a = 1; } }
function Same(x) { this.x = x; }
function Under(x) { this.x = x; }
function isLeaf(o) { return o instanceof Leaf; }
function sameIsLeaf() { const made = new Same(1); return made instanceof Leaf; }
function underIsLeaf() { const made = new Under(1); return made instanceof Leaf; }

function deed() {
  Same.prototype = Leaf.prototype;
  Under.prototype = Object.create(Leaf.prototype);
}
deed();
console.log(String(isLeaf(new Same(1))), String(isLeaf(new Under(1))), String(sameIsLeaf()), String(underIsLeaf()), String(isLeaf(new Leaf())), String(new Leaf() instanceof Same), String(new Leaf() instanceof Under));
let count = 0;
for (let i = 0; i < 200; i++) count += (sameIsLeaf() ? 1 : 0) + (underIsLeaf() ? 1 : 0) + (isLeaf(i & 1 ? new Same(i) : new Under(i)) ? 1 : 0);
console.log(String(count));
