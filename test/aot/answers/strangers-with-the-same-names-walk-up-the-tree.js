// answers: without-library
// # The walk up a tree of nodes of an untyped file, entered with what nobody expects: a literal with the same names, an accessor under one of them, a number, a text, undefined and null in the place of a link, a proxy.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 70 of 70 of 70
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
function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
var root = new TreeNode(3); root.stateNode = "root";
var middle = new TreeNode(4); attach(root, middle); twin(middle);
var leaf = new TreeNode(5); attach(middle, leaf);
var leaves = [leaf, middle];
globalThis.seen = root;
for (var round = 0; round < 4; round++) { report(markUp(leaves[round & 1], 1 << round)); report(root.childLanes); report(middle.childLanes); report(middle.alternate.childLanes); report(leaf.lanes); }
var stranger = { childLanes: "s", alternate: null, return: root, tag: 9, stateNode: "no", lanes: 1 };
var withAccessor = { get childLanes() { return 64; }, set childLanes(v) { report("set " + v); }, alternate: null, return: middle, tag: 9, stateNode: "no", lanes: 0 };
var others = [stranger, withAccessor, { return: stranger, alternate: null, lanes: 0 }, { return: withAccessor, alternate: leaf, lanes: 0 }, { return: 7, alternate: null, lanes: 0 }, { return: "text", alternate: null, lanes: 0 }, { return: undefined, alternate: null, lanes: 0 }, { return: null, alternate: undefined, lanes: 0 }, new Proxy(leaf, {}), null, undefined, 8];
for (var which = 0; which < others.length; which++) { var other = others[which]; report(tell(function () { return markUp(other, 128); })); report(root.childLanes); report(String(stranger.childLanes)); report(leaf.lanes); }
report("end");
