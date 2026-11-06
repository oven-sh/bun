// The twin of a node is asked for one thing only, its index, a name that arrays of matches have too.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));
function TreeNode(index) { this.index = index; this.flags = 0; this.twin = null; this.sibling = null; }
function place(node, last, index) {
  node.index = index;
  var twin = node.twin;
  if (null !== twin) return (twin = twin.index), twin < last ? ((node.flags |= 2), last) : twin;
  node.flags |= 2;
  return last;
}
const nodes = [];
for (let i = 0; i < 8; i++) { const node = new TreeNode(i), twin = new TreeNode(7 - i); node.twin = twin; twin.twin = node; nodes.push(node); }
const rounds = Number(process.argv[2] ?? 200000);
const given = open(nodes);
let sum = 0;
for (let i = 0; i < rounds; i++) { let last = 0; for (let k = 0; k < 8; k++) last = place(given[k], last, k); sum += last; }
console.log(sum, nodes[3].flags);
