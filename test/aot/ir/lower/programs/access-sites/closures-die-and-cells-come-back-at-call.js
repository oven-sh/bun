// RUN: lower
// OPTIONS: builtin-modules

// A call site meets a closure, the closure dies, and a collection later other closures, of other code, stand where it stood. The site calls each of them, not what it remembers.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

function callIt(callee) {
  return callee(1);
}
function callMethod(holder) {
  return holder.act(2);
}
function construct(callee) {
  return new callee(3).made;
}

function firstKind(captured) {
  return function (argument) {
    return "first " + captured + " " + argument;
  };
}
function secondKind(captured) {
  return function (argument) {
    return "second " + captured + " " + argument;
  };
}
function thirdKind(captured) {
  return argument => "third " + captured + " " + argument;
}
function firstMaker(captured) {
  return function (argument) {
    this.made = "made first " + captured + " " + argument;
  };
}
function secondMaker(captured) {
  return function (argument) {
    this.made = "made second " + captured + " " + argument;
  };
}

function teach(round) {
  // Only this frame holds the closures.
  return [callIt(unknown(firstKind(round))), callMethod(unknown({ act: firstKind(round) })), construct(unknown(firstMaker(round)))].join(" | ");
}
function fillStack(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}

let wrong = 0;
function check(actual, expected) {
  if (actual !== expected) {
    wrong++;
    if (wrong < 10) console.log("WRONG:", actual, "instead of", expected);
  }
}

for (let round = 0; round < 6; round++) {
  console.log(teach(round));
  console.log(teach(round));
  fillStack(50);
  Bun.gc(true);
  const kept = [];
  for (let i = 0; i < 3000; i++) {
    const kind = i % 3;
    const callee = kind === 0 ? secondKind(i) : kind === 1 ? thirdKind(i) : firstKind(i);
    const name = kind === 0 ? "second " : kind === 1 ? "third " : "first ";
    kept.push(callee);
    check(callIt(unknown(callee)), name + i + " 1");
    check(callMethod(unknown({ act: callee })), name + i + " 2");
    const maker = i % 2 ? secondMaker(i) : firstMaker(i);
    kept.push(maker);
    check(construct(unknown(maker)), (i % 2 ? "made second " : "made first ") + i + " 3");
  }
  console.log("round", round, "kept", kept.length, "wrong", wrong);
}

export {};

// GENERATED: callMethod construct firstKind fillStack unknown
// CHECK-LABEL: function {{*}}name="callMethod"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="act"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="act" calleeName="holder.act"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = Integer integer=3
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="callee"
// CHECK-NEXT: v3 = PropGet v2 key="made"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstKind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fillStack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Add v0, v3
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = NewArray v0, v2, v4, v6 contents=anything
// CHECK-NEXT: v8 = ToBoolean v0
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Sub v0, v11
// CHECK-NEXT: v13 = Call v10, -, v12 calleeName="fillStack"
// CHECK-NEXT: v14 = PropGet v7 key="length"
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]]|[[f_5]]|[[f_6]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]|[[f_5]]|[[f_6]]):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="CustomEvent" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(CustomEvent) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="unknown"
// CHECK-NEXT: v5 = NewObject -, v0 layout=[[L_7]] fields=[3]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Construct v3, -, v4, v6 calleeName="CustomEvent"
// CHECK-NEXT: v8 = PropGet v7 key="detail"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
