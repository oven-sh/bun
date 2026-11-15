function inner() {
  class Leaf { tag() { return "leaf"; } }
  return Leaf;
}
function outer() {
  const Leaf = inner();
  class Branch extends Leaf { tag() { return "branch of " + super.tag(); } }
  return [Leaf, Branch];
}
const [Leaf, Branch] = outer();
console.log(new Leaf().tag(), new Branch().tag(), new Branch() instanceof Leaf);
