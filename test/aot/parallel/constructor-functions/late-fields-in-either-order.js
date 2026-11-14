// Either arm gives a new object its late fields in an order of its own: the keys come in the order of the stores.
function Node(key, value) { this.key = key; this.value = value; }
Node.prototype.left = null;
Node.prototype.right = null;
const kinds = { Node };
function Tree() { this.root = null; }
Tree.prototype.insert = function (key) {
  const node = new kinds.Node(key, null);
  if (!this.root) node.left = node.right = null;
  else if (key & 1) {
    node.left = this.root;
    node.right = this.root.right;
  } else {
    node.right = this.root;
    node.left = this.root.left;
  }
  if (key % 5 === 0) node.right = null;
  this.root = node;
  return node;
};
class Cell { constructor(name) { this.name = name; } }
function fill(i) {
  const cell = new Cell("c" + i);
  if (i % 3 === 0) cell.up = i;
  if (i % 2) {
    cell.down = i + 1;
    cell.tag = null;
  } else {
    cell.tag = "even";
    cell.down = i * 0.5;
  }
  if (i % 7 === 0) cell.up = "seven";
  return cell;
}
function other(i) {
  const made = i & 4 ? new kinds.Node(i, i) : new Cell(i);
  if (i & 1) { made.first = 1; made.second = 2; } else { made.second = 3; made.first = 4; }
  return made;
}
const keys = object => { let names = Object.keys(object).join(); for (const name in object) names += " " + name; return names; };
function run(from, to) {
  const tree = new Tree();
  const seen = new Map();
  const count = (kind, object) => seen.set(kind + ": " + keys(object), (seen.get(kind + ": " + keys(object)) ?? 0) + 1);
  for (let i = from; i < to; i++) {
    count("node", tree.insert(i));
    count("cell", fill(i));
    count("other", other(i));
  }
  console.log([...seen].map(([kind, n]) => kind + " x" + n).sort().join("\n"));
  let depth = 0;
  for (let node = tree.root; node && depth < 100; node = node.key & 1 ? node.left : node.right) depth++;
  console.log(depth, JSON.stringify(fill(6)), JSON.stringify(fill(21)));
}
run(1, 60);
function Short(key) { this.right = key; this.key = key; }
kinds.Node = Short;
run(1, 60);
kinds.Node = function (key) { return Object.freeze({ key }); };
try {
  run(1, 60);
} catch (error) {
  console.log(error.constructor.name);
}
kinds.Node = Node;
Object.defineProperty(Node.prototype, "left", { set(value) { this.seen = typeof value; }, get() { return null; }, configurable: true });
run(1, 60);
