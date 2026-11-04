// One step of a walk over a tree gets a node and its twin. The twin is null for a new node and an object for an old one, and the step asks `twin === null`
// in arm after arm, as the render step of a UI library does. Both answers occur, so the code on both sides of the question has to be fast.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));

function TreeNode(tag, pending) {
  this.tag = tag;
  this.pending = pending;
  this.settled = null;
  this.lanes = 1;
  this.flags = 0;
  this.child = null;
  this.twin = null;
}

let didChange = false;

function begin(twin, node, lane) {
  if (twin !== null) didChange = twin.settled !== node.pending || (twin.flags & 4) !== 0;
  else didChange = false;
  node.lanes = 0;
  switch (node.tag) {
    case 0:
      if (twin === null) node.flags |= 2;
      else node.flags |= twin.flags & 8;
      node.settled = node.pending;
      return node.child;
    case 1:
      node.flags |= twin === null ? 1 : twin.lanes & lane;
      node.settled = node.pending;
      return node.child;
    case 2:
      if (twin !== null && !didChange) return null;
      node.settled = node.pending;
      return twin === null ? node.child : twin.child;
  }
  return null;
}

function build(count, withTwins) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const node = new TreeNode(i % 3, { id: i });
    if (withTwins) {
      const twin = new TreeNode(i % 3, node.pending);
      twin.settled = i % 2 ? node.pending : null;
      twin.flags = i % 16;
      node.twin = twin;
      twin.twin = node;
    }
    if (i > 0) nodes[i - 1].child = node;
    nodes.push(node);
  }
  return nodes;
}

const rounds = Number(process.argv[2] ?? 100000);
const fresh = open(build(6, false)), old = open(build(6, true));
let answers = 0;
for (let i = 0; i < rounds; i++) {
  for (const node of i & 1 ? old : fresh) if (begin(open(node.twin), open(node), 1 << (i & 7)) !== null) answers++;
}
console.log(answers, didChange, old[1].flags, fresh[1].flags, old[5].lanes);
