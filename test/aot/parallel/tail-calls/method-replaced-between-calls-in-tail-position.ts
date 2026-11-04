// the method that a function calls in tail position is replaced on the prototype, and shadowed on one instance
class Leaf {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  weigh(scale: number): number | string {
    return this.size * scale;
  }
}
function visit(node: Leaf, scale: number): number | string {
  return node.weigh(scale);
}
function deed(node: Leaf) {
  return String(visit(node, 2));
}
console.log(deed(new Leaf(1)));
for (let i = 0; i < 4; i++) console.log(deed(new Leaf(i)));
const shadowed = new Leaf(5);
shadowed.weigh = () => "shadow";
console.log(deed(shadowed));
console.log(deed(new Leaf(5)));
Leaf.prototype.weigh = function (scale: number) {
  return "replaced " + this.size * scale;
};
console.log(deed(new Leaf(6)));
console.log(deed(shadowed));
