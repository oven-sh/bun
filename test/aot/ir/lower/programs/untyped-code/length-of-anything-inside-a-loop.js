// RUN: lower
// OPTIONS: builtin-modules

// `x.length` inside a loop, x of unknown type. A plain array answers in line; everything else goes the general way. Here: arrays of every kind of storage (integers, doubles, values, holes, none yet, a literal shared until written, sparse storage), lengths that no int32 holds, arrays that grow, shrink or are emptied while the loop runs, frozen ones, heirs of Array, an array whose prototype has changed; and what is no array: strings and ropes, typed arrays, arguments, functions, objects with a field, a getter or an inherited `length`, proxies, primitives, null and undefined.
const lines = [];
const say = (...words) => lines.push(words.map(String).join(" "));
const count = x => {
  let turns = 0;
  for (let i = 0; i < x.length; i++) turns++;
  return turns;
};
const lengths = (list, times) => {
  const seen = [];
  for (let round = 0; round < times; round++) {
    for (let i = 0; i < list.length; i++) {
      let answer;
      try { answer = list[i].length; } catch (error) { answer = error.constructor.name; }
      if (round === times - 1) seen.push(typeof answer + ":" + String(answer));
    }
  }
  return seen.join(" ");
};
const sparse = [1, 2, 3];
sparse[100000] = 4;
const huge = new Array(4294967295);
const justOver = new Array(2147483648);
const justUnder = new Array(2147483647);
const holey = [1, , 3];
const undecided = new Array(5);
const shared = () => [1, 2, 3, 4];
class Heir extends Array {}
class Lying extends Array { get length() { return 42; } set length(value) {} }
const heir = Heir.from([1, 2, 3]);
const reparented = [1, 2];
Object.setPrototypeOf(reparented, { get length() { return "never asked"; }, extra: true });
const nullProto = [1, 2, 3];
Object.setPrototypeOf(nullProto, null);
function args() { return arguments; }
let asked = 0;
const everything = [
  [], [1], [1.5, 2.5], ["a", {}, null], holey, undecided, shared(), sparse, huge, justOver, justUnder, Object.freeze([1, 2]), Object.seal([1]), heir, new Lying(), reparented, nullProto,
  "", "text", "ro" + String(lines.length) + "pe", new String("boxed"), new Uint8Array(7), new Float64Array(2), new DataView(new ArrayBuffer(8)), args(1, 2, 3), function (a, b) {}, () => {}, class { constructor(a) {} },
  { length: 3 }, { length: "three" }, { get length() { asked++; return -1; } }, Object.create({ length: 9 }), Object.create([1, 2, 3]), {}, new Proxy([1, 2], {}), new Proxy({}, { get: (t, k) => "trapped " + String(k) }),
  0, 1.5, true, Symbol.iterator, 10n, null, undefined, new Map([[1, 2]]), new Set([1]), /x/g, new Error("e"),
];
say(lengths(everything, 3));
say("the getter ran", asked);
for (const x of [[], [1, 2, 3], "four", new Uint8Array(5), { length: 2 }, args(1), sparse, heir, { length: 2.5 }, { length: "3" }, { length: NaN }, {}]) say("turns", count(x));
const growing = [1];
let turns = 0;
for (let i = 0; i < growing.length && turns < 10; i++) { turns++; growing.push(i); }
say("grows", turns, growing.length);
const shrinking = [1, 2, 3, 4, 5, 6];
turns = 0;
for (let i = 0; i < shrinking.length; i++) { turns++; shrinking.pop(); }
say("shrinks", turns, shrinking.length);
const emptied = [1, 2, 3, 4];
turns = 0;
for (let i = 0; i < emptied.length; i++) { turns++; if (i === 1) emptied.length = 0; }
say("emptied", turns, emptied.length);
const stretched = [1, 2];
turns = 0;
for (let i = 0; i < stretched.length && turns < 8; i++) { turns++; if (i === 0) stretched.length = 5; if (i === 3) stretched[200000] = 1; if (i === 5) stretched.length = 6; }
say("stretched", turns, stretched.length);
const becomes = [[1, 2, 3]];
const changing = holder => {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(holder[0].length);
    if (i === 1) holder[0] = "now a string";
    if (i === 2) holder[0] = { length: "a field" };
    if (i === 3) holder[0] = new Uint16Array(3);
    if (i === 4) holder[0] = [];
  }
  return seen.join(",");
};
say("changing", changing(becomes));
const written = shared();
for (let i = 0; i < written.length && i < 6; i++) if (i === 2) written.push(5, 6);
say("a literal that is written", written.length, shared().length);
const nested = [[1, 2], [], [3], "ab", [4, 5, 6]];
let total = 0;
try {
  for (let i = 0; i < nested.length; i++) for (let j = 0; j < nested[i].length; j++) total += 1;
  for (let i = 0; i <= nested.length; i++) total += nested[i].length;
} catch (error) {
  say("under try", total, error.constructor.name);
}
console.log(lines.join("\n"));

// GENERATED: args count Heir length
// CHECK-LABEL: function {{*}}name="args"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = CreateUnmappedArguments v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]]|[[L_2]]|Array<number>|Uint8Array flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]|[[L_2]]|Array<number>|Uint8Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Increment v5
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = Increment v11
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v13, v15)
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=42
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="never asked"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="asked"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="asked"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_5]]
// CHECK-NEXT: v7 = Integer integer=-1
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
