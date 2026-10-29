// RUN: lower
// OPTIONS: builtin-modules

// A tree of nodes made by a constructor function, each with a twin, walked from a leaf to the root as a UI library marks an update.
// Four other kinds of objects have a field of the same name as the one the walk asks the twin for, and they are made more often.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));

function TreeNode(tag) {
  this.tag = tag;
  this.lanes = 0;
  this.childLanes = 0;
  this.twin = null;
  this.parent = null;
  this.state = null;
}

function makeQueue() { return { pending: null, lanes: 0, dispatch: null }; }
function makeDependencies() { return { lanes: 0, first: null }; }
function makeShared() { return { interleaved: null, lanes: 0, callbacks: null, hidden: null }; }
function makeRoad() { return { name: "road", width: 3, length: 12, lanes: 2 }; }

function markFromLeaf(source, lane) {
  source.lanes |= lane;
  var twin = source.twin;
  null !== twin && (twin.lanes |= lane);
  for (var parent = source.parent; null !== parent; )
    (parent.childLanes |= lane),
      (twin = parent.twin),
      null !== twin && (twin.childLanes |= lane),
      (source = parent),
      (parent = parent.parent);
  return 3 === source.tag ? source.state : null;
}

function build(depth) {
  let parent = null, parentTwin = null, leaf = null;
  for (let i = 0; i < depth; i++) {
    const node = new TreeNode(i === 0 ? 3 : 5), twin = new TreeNode(i === 0 ? 3 : 5);
    node.twin = twin; twin.twin = node;
    node.parent = parent; twin.parent = parentTwin;
    if (i === 0) node.state = twin.state = { name: "root" };
    parent = node; parentTwin = twin; leaf = node;
  }
  return leaf;
}

let others = 0;
for (let i = 0; i < 4000; i++) others += makeQueue().lanes + makeDependencies().lanes + makeShared().lanes + makeRoad().lanes;

const rounds = Number(process.argv[2] ?? 200000);
const leaf = open(build(12));
let found = 0;
for (let i = 0; i < rounds; i++) if (markFromLeaf(open(leaf), 1 << (i & 15)) !== null) found++;
console.log(found, others, leaf.lanes, leaf.twin.lanes, leaf.parent.childLanes);

// GENERATED: TreeNode makeQueue
// CHECK-LABEL: function {{*}}name="TreeNode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="tag"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: PropSet v4, v5 key="lanes"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: PropSet v7, v8 key="childLanes"
// CHECK-NEXT: v10 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: PropSet v10, v11 key="twin"
// CHECK-NEXT: v13 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Null
// CHECK-NEXT: PropSet v13, v14 key="parent"
// CHECK-NEXT: v16 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Null
// CHECK-NEXT: PropSet v16, v17 key="state"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeQueue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_4]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
