// RUN: lower
// OPTIONS: builtin-modules

// A loop with two labels continues to the outer one, loops store to variables named `using` and `async`, and an optional chain in parentheses is a tag and the callee of `new`.
// Plain Bun prints another output.
let turns = 0;
outer: inner: while (turns < 3) {
  turns++;
  continue outer;
}
console.log("continues to the outer of two labels:", turns);
let rounds = 0;
first: second: third: for (let i = 0; i < 4; i++) {
  rounds++;
  if (i % 2) continue first;
  continue second;
}
console.log("of three labels:", rounds);

var using;
for (using of [1, 2]);
console.log("a loop stores to a variable named using:", using);
var async;
async function walks() {
  for await (async of [3, 4]);
  return async;
}

const holder = {
  label: "holder",
  tag(strings, value) {
    return strings.join("|") + " " + value + " " + (this === holder ? "this is the holder" : typeof this);
  },
  Made: class {
    constructor(value) {
      this.value = value;
    }
  },
};
const nothing = null;
console.log("a tag:", (holder?.tag)`a${1}b`);
console.log("behind new:", new (holder?.Made)(5).value);
for (const run of [() => (nothing?.tag)`x`, () => new (nothing?.Made)()]) {
  try {
    run();
  } catch (error) {
    console.log("of nothing:", error.constructor.name);
  }
}
console.log("a loop stores to a variable named async:", await walks());

// GENERATED: walks tag Made
// CHECK-LABEL: function {{*}}name="walks"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = IteratorOpen v1 iteratorKind=Async
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2 iteratorKind=Async
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_2]]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v9 = CatchException
// CHECK-NEXT: IteratorClose v2 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = PropGet v1 key="join"
// CHECK-NEXT: v4 = String string="|"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="join" calleeName="strings.join"
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Add v7, v2
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="holder"
// CHECK-NEXT: v13 = StrictEq v0, v12
// CHECK-NEXT: Branch v13 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v14 = String string="this is the holder"
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = TypeOf v0
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Add v10, v16
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]]}
// CHECK-NEXT: PropSet v4, v1 key="value"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
