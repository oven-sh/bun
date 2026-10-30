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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v3 = IteratorOpen v2 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3 iteratorKind=Async
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_2]]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v3:
// CHECK-NEXT: v10 = CatchException
// CHECK-NEXT: IteratorClose v3 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v1 key="join"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="|"
// CHECK-NEXT: v6 = Call v4, v1, v5 calleeKey="join" calleeName="strings.join"
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Add v8, v2
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="holder"
// CHECK-NEXT: v15 = StrictEq v12, v14
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = String string="this is the holder"
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v18 = TypeOf v17
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = Add v11, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="value"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
