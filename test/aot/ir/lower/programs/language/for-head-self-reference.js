// RUN: lower
// OPTIONS: builtin-modules

// `for (let x of [x])`: what stands behind `of` or `in` is evaluated where the loop's own names are declared and hold nothing yet.
function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
tell("let in", () => { let x = 1; for (let x in { x }) return "entered"; return "left"; });
tell("const in", () => { let x = 1; for (const x in { x }) return "entered"; return "left"; });
tell("let of", () => { let x = 1; for (let x of [x]) return "entered"; return "left"; });
tell("const of", () => { let x = 1; for (const x of [x]) return "entered"; return "left"; });
tell("a pattern", () => { let b = 1; for (const [a, b] of [[b, 2]]) return "entered"; return "left"; });
tell("a pattern's other name", () => { let a = 1; for (const { a, b } of [{ a, b: 2 }]) return "entered"; return "left"; });
tell("var", () => { for (var x of [x]) return String(x); return "left"; });
tell("not evaluated", () => { let x = 1; for (let x of true ? [5] : [x]) return x; return "left"; });
tell("typeof", () => { for (let x of [typeof x]) return x; return "left"; });
tell("in a function that is called at once", () => { for (let x of [(() => x)()]) return x; return "left"; });
tell("in a function that is called later", () => { const all = []; for (let x of [() => x, () => x]) all.push(x); return all.map(f => typeof f()).join(); });
tell("another name", () => { let y = 3; for (let x of [y]) return x; return "left"; });
tell("twice", () => { let n = 0; for (let turn = 0; turn < 2; turn++) { try { for (let x of [x]) n += 10; } catch { n++; } } return n; });
async function later() {
  try {
    for await (let x of [x]) return "entered";
    return "left";
  } catch (error) {
    return error.constructor.name;
  }
}
later().then(said => console.log("for await", said));
let top = 1;
try {
  for (let top of [top]) console.log("entered");
} catch (error) {
  console.log("at the top level", error.constructor.name);
}

// GENERATED: tell later
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v9 key="constructor"
// CHECK-NEXT: v16 = PropGet v15 key="name"
// CHECK-NEXT: v17 = Call v14, v12, v0, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b7():
// CHECK-NEXT: v1 = Absent
// CHECK-NEXT: v2 = CheckInitialized v1 name="x"
// CHECK-NEXT: v3 = NewArray v2 contents=anything
// CHECK-NEXT: v4 = IteratorOpen v3 iteratorKind=Async
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4 iteratorKind=Async
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v9 = String string="left"
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b6():
// CHECK-NEXT: v10 = String string="entered"
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11) handler=b7():
// CHECK-NEXT: IteratorClose v4 iteratorKind=Async
// CHECK-NEXT: Return v11
// CHECK-NEXT: b6() role=IterationCleanup subject=v4 handler=b7():
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v4 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: b7() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = PropGet v15 key="constructor"
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
