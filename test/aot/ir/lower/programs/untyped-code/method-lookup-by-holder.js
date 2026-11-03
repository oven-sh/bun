// RUN: lower
// OPTIONS: builtin-modules

// o.m() at one untyped call site, by where the method is stored: own or inherited, inline or out of line, near or far up the prototype chain.
// Then receivers that need the slow path at the same site, and methods that change between two calls.
const lines = [];

function callWithTwo(o, a, b) { return o.m(a, b); }
function callWithEight(o, a, b, c, d, e, f, g, h) { return o.m(a, b, c, d, e, f, g, h); }
const sites = [callWithTwo, callWithEight];

function attempt(call, receiver) {
  try {
    return call(receiver, 1, 2, 3, 4, 5, 6, 7, 8);
  } catch (error) {
    return error.constructor.name;
  }
}

function method(label) {
  return function (...values) { return `${label}, this ${this.id}, arguments ${values.join("")}`; };
}

// Object.create and computed property names produce ordinary objects with out-of-line storage, whatever layout the compiler picks for literals.
function create(prototype, id, fillers = 0) {
  const object = Object.create(prototype);
  object.id = id;
  for (let i = 0; i < fillers; i++) object["filler" + i] = i;
  return object;
}

function createOwn() {
  const inline = create(Object.prototype, "a");
  inline.m = method("own inline");
  const outOfLine = create(Object.prototype, "b", 20);
  outOfLine.m = method("own out of line");
  return [
    { name: "own inline", receiver: inline },
    { name: "own out of line", receiver: outOfLine },
  ];
}

function createInherited() {
  const cases = [];
  for (const [name, fillers] of [["prototype inline", 0], ["prototype out of line", 20], ["prototype far out of line", 160]]) {
    const holder = create(Object.prototype, "holder", fillers);
    holder.m = method(name);
    cases.push({ name, holder, receiver: create(holder, "c" + fillers) });
  }
  const holder = create(Object.prototype, "holder");
  holder.m = method("two levels up");
  const middle = create(holder, "middle");
  cases.push({ name: "two levels up", holder, middle, receiver: create(middle, "d") });
  return cases;
}

let getterReads = 0;
const trapped = [];

function createOthers() {
  const ownGetter = create(Object.prototype, "e");
  Object.defineProperty(ownGetter, "m", { get() { getterReads++; return method("own getter"); } });
  const getterHolder = create(Object.prototype, "holder");
  Object.defineProperty(getterHolder, "m", { get() { getterReads++; return method("inherited getter"); } });
  const number = create(Object.prototype, "g");
  number.m = 1;
  const proxy = new Proxy(create(Object.prototype, "h"), {
    get(target, key, receiver) {
      trapped.push(key);
      return key === "m" ? method("proxy") : Reflect.get(target, key, receiver);
    },
  });
  return [
    { name: "own getter", receiver: ownGetter },
    { name: "inherited getter", receiver: create(getterHolder, "f") },
    { name: "absent", receiver: create(Object.prototype, "i") },
    { name: "the number 1", receiver: number },
    { name: "string receiver", receiver: "text" },
    { name: "proxy receiver", receiver: proxy },
    { name: "null receiver", receiver: null },
  ];
}

const found = [...createOwn(), ...createInherited()];
const all = [...found, ...createOthers()];
const outcomes = all.map(() => new Set());
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < all.length; i++) {
    for (const call of sites) outcomes[i].add(attempt(call, all[i].receiver));
  }
}
all.forEach(({ name }, i) => lines.push(`${name}: ${[...outcomes[i]].join(" | ")}`));
lines.push(`getters read ${getterReads} times, ${trapped.length} traps for ${[...new Set(trapped)].join()}`);

function summarize(results) {
  const runs = [];
  for (const result of results) {
    const last = runs[runs.length - 1];
    if (last && last.result === result) last.count++;
    else runs.push({ result, count: 1 });
  }
  return runs.map(run => `${run.count} x ${run.result}`).join(", then ");
}

// The other receivers go through the site between two calls, so that it never settles on one structure.
function callAcrossChange(name, receiver, change) {
  const results = [];
  for (let round = 0; round < 6; round++) {
    if (round === 3) change();
    for (const other of found) attempt(callWithTwo, other.receiver);
    results.push(attempt(callWithTwo, receiver));
  }
  lines.push(`${name}: ${summarize(results)}`);
}

for (const { name, holder, receiver } of createInherited())
  callAcrossChange(`${name}, replaced`, receiver, () => { holder.m = method("replacement"); });
for (const { name, holder, receiver } of createInherited())
  callAcrossChange(`${name}, deleted`, receiver, () => { delete holder.m; });
for (const { name, holder, receiver } of createInherited())
  callAcrossChange(`${name}, redefined as a getter`, receiver, () => { Object.defineProperty(holder, "m", { get() { return method("getter"); } }); });
for (const { name, receiver } of createInherited())
  callAcrossChange(`${name}, shadowed by an own method`, receiver, () => { receiver.m = method("own"); });
for (const { name, holder, receiver } of createInherited())
  callAcrossChange(`${name}, holder grows`, receiver, () => { for (let i = 0; i < 40; i++) holder["late" + i] = i; });
{
  const { middle, receiver } = createInherited()[3];
  callAcrossChange("two levels up, shadowed one level up", receiver, () => { middle.m = method("one level up"); });
}
{
  const [first, second] = createInherited();
  callAcrossChange("prototype inline, receiver gets another prototype", first.receiver, () => { Object.setPrototypeOf(first.receiver, second.holder); });
}

console.log(lines.join("\n"));

// GENERATED: attempt summarize
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = Integer integer=4
// CHECK-NEXT: v6 = Integer integer=5
// CHECK-NEXT: v7 = Integer integer=6
// CHECK-NEXT: v8 = Integer integer=7
// CHECK-NEXT: v9 = Integer integer=8
// CHECK-NEXT: v10 = Call v0, -, v1, v2, v3, v4, v5, v6, v7, v8, v9 calleeName="call"
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = PropGet v11 key="constructor"
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="summarize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v4 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v3 declared={type=undefined|null|Array<undefined|null|[[L_2]]> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="map"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = NewClosure function=[[f_4]]
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="map" calleeName="runs.map"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=", then "
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b15():
// CHECK-NEXT: v19 = Convert v3 declared={type=undefined|null|Array<undefined|null|[[L_2]]> flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b15():
// CHECK-NEXT: v20 = PropGet v19 key="length"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Sub v21, v22
// CHECK-NEXT: v24 = ElemGet v19, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b7(| 0), notTaken b12(| 0)
// CHECK-NEXT: b7(v27) handler=b15():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b15():
// CHECK-NEXT: v28 = PropGet v27 key="result"
// CHECK-NEXT: v29 = StrictEq v28, v8
// CHECK-NEXT: Branch v29 -> taken b9(| 1), notTaken b11(| 1)
// CHECK-NEXT: b9(v30) handler=b15():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b15():
// CHECK-NEXT: v31 = PropGet v27 key="count"
// CHECK-NEXT: v32 = Increment v31
// CHECK-NEXT: v33 = Convert v32 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v27, v33 key="count"
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b11(v35) handler=b15():
// CHECK-NEXT: Jump -> next b13(v35)
// CHECK-NEXT: b12(v36) handler=b15():
// CHECK-NEXT: Jump -> next b13(v8)
// CHECK-NEXT: b13(v37) handler=b15():
// CHECK-NEXT: v38 = PropGet v19 key="push"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v40 = Integer integer=1
// CHECK-NEXT: v41 = Convert v40 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v42 = NewObject -, v37 layout=[[L_2]] fields=[1]
// CHECK-NEXT: PropDefine v42, v41 key="count"
// CHECK-NEXT: v44 = FinishObject v42
// CHECK-NEXT: v45 = Call v39, v19, v44 calleeKey="push" calleeName="runs.push"
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14() handler=b15():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b15() role=IterationCleanup subject=v4:
// CHECK-NEXT: v46 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v46
// CHECK-NEXT: }
