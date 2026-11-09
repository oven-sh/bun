// answers: without-library
// # `for (var parent = source.return; null !== parent; parent = parent.return) parent.childLanes |= lane`: an untyped file writes nothing of the nodes, and unseen code has them. One layout has all the names that the loop's variable is asked for.
// # The names are read off the name that `null !== parent` has narrowed. That name asked the variable behind it, was told nothing and gave up; and `undefined | object`, which is all that is seen to arrive at `source`, was cut to `undefined`, of which no name is read. So every step up the tree was closed.
// # f4 = markUp
// # RUN(TYPED): walk f4 mechanisms=all
// # TYPED-LABEL: code f4:Body
// # TYPED: key="return" receivers=[L0]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
function TreeNode(tag) { this.tag = tag; this.lanes = 0; this.childLanes = 0; this.return = this.child = this.sibling = this.alternate = null; this.stateNode = null; }
function attach(parent, child) { child.return = parent; child.sibling = parent.child; parent.child = child; }
function twin(node) { var other = node.alternate; if (null === other) { other = new TreeNode(node.tag); other.alternate = node; node.alternate = other; } return other; }
function markUp(source, lane) {
  source.lanes |= lane;
  var alternate = source.alternate;
  null !== alternate && (alternate.lanes |= lane);
  for (var parent = source.return; null !== parent; parent = parent.return) {
    parent.childLanes |= lane;
    alternate = parent.alternate;
    null !== alternate && (alternate.childLanes |= lane);
    source = parent;
  }
  return 3 === source.tag ? source.stateNode : null;
}
var root = new TreeNode(3);
root.stateNode = { name: "root" };
var leaves = [];
(function grow(parent, depth) {
  for (var i = 0; i < 3; i++) {
    var node = new TreeNode(depth);
    attach(parent, node);
    if (i === 1) twin(node);
    if (depth < 5) grow(node, depth + 1);
    else leaves.push(node);
  }
})(root, 4);
globalThis.seen = root;
Reflect.ownKeys(root);
var found = 0;
for (var turn = 0; turn < 3; turn++) {
  for (var at = 0; at < leaves.length; at++) found += markUp(leaves[at], 1 << (turn & 15)) === root.stateNode ? 1 : 0;
}
report(found); report(root.childLanes); report(leaves.length); report(leaves[1].alternate.lanes); report(leaves[0].return.childLanes);
report("end");
