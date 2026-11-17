// answers: without-library
// # The walk up a tree of nodes of an untyped file. One layout of the program has all the names that the loop's variable is asked for, so it is expected; objects that JSON.parse made, with the same names in another order, stand in the tree too.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
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
var made = JSON.parse('{"stateNode":"made","tag":3,"return":null,"alternate":null,"childLanes":"c","lanes":0}');
var below = JSON.parse('{"alternate":null,"childLanes":256,"lanes":0,"tag":8,"stateNode":null,"return":null}');
below.return = made;
var lowest = new TreeNode(9);
lowest.return = below;
leaves.push(lowest, below);
globalThis.seen = root;
Reflect.ownKeys(root);
var found = 0;
for (var turn = 0; turn < 3; turn++) {
  for (var at = 0; at < leaves.length; at++) found += markUp(leaves[at], 1 << (turn & 15)) === root.stateNode ? 1 : 0;
}
report(found); report(made.childLanes); report(below.childLanes); report(markUp(lowest, 2)); report(markUp(below, 4)); report(made.childLanes); report(below.childLanes); report(below.lanes); report(root.childLanes); report(leaves.length); report(leaves[1].alternate.lanes); report(leaves[0].return.childLanes);
report("end");
