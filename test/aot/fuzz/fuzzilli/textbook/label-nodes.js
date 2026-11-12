class Leaf {
  constructor(text) {
    this.text = text;
    this.depth = 1;
  }
}
class Branch {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }
}
class Link {
  constructor(target) {
    this.target = target;
  }
}
class Mark {
  constructor(color) {
    this.color = color;
  }
}
function label(node) {
  let out = `${node.text}`;
  if (typeof node === "string") return out;
  out += ":" + node.text + ":" + node.depth;
  return out;
}
const nodes = [new Leaf("a"), new Branch(1, 2), new Link("b"), new Mark("red"), new Leaf("c"), "plain"];
let index = 0;
while (index < nodes.length) {
  console.log(label(nodes[index]));
  index++;
}
