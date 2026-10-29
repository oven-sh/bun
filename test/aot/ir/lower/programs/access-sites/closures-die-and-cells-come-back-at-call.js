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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="act"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="act" calleeName="holder.act"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=3
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="callee"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="made"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstKind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fillStack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Integer integer=3
// CHECK-NEXT: v7 = Add v1, v6
// CHECK-NEXT: v8 = NewArray v1, v3, v5, v7 contents=anything
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v10 = ToBoolean v1
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v13 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Sub v13, v14
// CHECK-NEXT: v16 = Call v12, -, v15 calleeName="fillStack"
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v9 key="length"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = Add v17, v19
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]]|[[f_3]]|[[f_7]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]|[[f_3]]|[[f_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="CustomEvent" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(CustomEvent) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="unknown"
// CHECK-NEXT: v5 = NewObject -, v0 layout=[[L_9]] fields=[3]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Construct v3, -, v4, v6 calleeName="CustomEvent"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_10]]|Event flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="detail"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
