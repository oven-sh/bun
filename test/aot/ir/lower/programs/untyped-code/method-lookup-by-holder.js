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
// CHECK-NEXT: b1() handler=b2():
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
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = PropGet v11 key="constructor"
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="summarize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = PropGet v1 key="map"
// CHECK-NEXT: v8 = NewClosure function=[[f_2]]
// CHECK-NEXT: v9 = Call v7, v1, v8 calleeKey="map" calleeName="runs.map"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = String string=", then "
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v13 = PropGet v1 key="length"
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Sub v13, v14
// CHECK-NEXT: v16 = ElemGet v1, v15
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v18) handler=b10():
// CHECK-NEXT: v19 = PropGet v16 key="result"
// CHECK-NEXT: v20 = StrictEq v19, v6
// CHECK-NEXT: Branch v20 -> taken b6(), notTaken b8()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: v21 = PropGet v16 key="count"
// CHECK-NEXT: v22 = Increment v21
// CHECK-NEXT: PropSet v16, v22 key="count"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b7(v24) handler=b10():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v25 = PropGet v1 key="push"
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = NewObject -, v6, v26 layout=[[L_3]] fields=[1, 0]
// CHECK-NEXT: v28 = FinishObject v27
// CHECK-NEXT: v29 = Call v25, v1, v28 calleeKey="push" calleeName="runs.push"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b10() role=IterationCleanup subject=v2:
// CHECK-NEXT: v30 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v30
// CHECK-NEXT: }
