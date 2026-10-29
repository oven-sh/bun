// RUN: lower
// OPTIONS: builtin-modules

// id(), checkDefined(), orElse(), pick(), tap(), last(), first() and singleOrUndefined() are generic: the same functions pass objects, strings and numbers through, and their results are stored into number fields.
// Wherever the build looks, the numbers are small integers. A hidden caller of the function that fills the fields brings the others, through the very same helpers.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
function id<T>(x: T): T {
  return x;
}
function checkDefined<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error("not defined");
  return x;
}
function orElse<T>(x: T | undefined, fallback: T): T {
  return x ?? fallback;
}
function pick<T>(flag: boolean, a: T, b: T): T {
  return flag ? a : b;
}
function tap<T>(x: T, look: (x: T) => void): T {
  look(x);
  return x;
}
function last<T>(a: T, b: T, c: T): T {
  let result = a;
  for (const next of [b, c]) result = next;
  return result;
}
function first<T>(list: readonly T[]): T {
  return list[0];
}
function singleOrUndefined<T>(list: readonly T[]): T | undefined {
  return list.length === 1 ? list[0] : undefined;
}
class Filled { a = 0; b = 0; c = 0; d = 0; e = 0; f = 0; g = 0; }
class FromLists { h = 0; i = 0; }
function fillFromLists(o: FromLists, n: number) {
  o.h = first([n, 1]);
  o.i = singleOrUndefined([n]) ?? 0;
}
let looked = 0;
function fill(o: Filled, n: number) {
  o.a = id(n);
  o.b = checkDefined(n);
  o.c = orElse(n, 0);
  o.d = pick(looked >= 0, n, 1);
  o.e = tap(n, () => { looked++; });
  o.f = id(id(checkDefined(orElse(id(n), 2))));
  o.g = id(n) + id(1);
}
function fresh() {
  const o = new Filled();
  handOver(o);
  return o;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const o = fresh();
  fill(o, i & 63);
  sum += o.a + o.b + o.c + o.d + o.e + o.f + o.g;
  const lists = new FromLists();
  handOver(lists);
  fillFromLists(lists, i & 63);
  sum += lists.h + lists.i + first(["ab"]).length + first([{ k: 3 }]).k;
  sum += id("text").length + checkDefined({ k: 1 }).k + orElse<string>(undefined, "ab").length + pick(true, [1], [2, 3]).length + tap({ k: 2 }, () => {}).k + last("a", "bc", "def").length + last(1, 2, 3);
}
console.log("warm", sum, looked);
for (const value of odd) {
  const o = fresh();
  fill.call(undefined, o, value);
  const right = [o.a, o.b, o.c, o.d, o.e, o.f].every(stored => Object.is(stored, value)) && Object.is(o.g, value + 1);
  const lists = new FromLists();
  handOver(lists);
  fillFromLists.call(undefined, lists, value);
  console.log(`${exact(value)}: ${right} ${Object.values(o).map(exact).join(",")} ${JSON.stringify(o)} [${Object.keys(o)}] ${exact(o.a + o.b)} | ${Object.is(lists.h, value)} ${Object.is(lists.i, value)} ${JSON.stringify(lists)}`);
}
const o = fresh();
fill(o, 5);
console.log("an ordinary one afterwards:", JSON.stringify(o));

// GENERATED: first singleOrUndefined last fresh Filled
// CHECK-LABEL: function {{*}}name="first"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] site=[[w_4]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="singleOrUndefined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_5]]> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_5]] site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_5]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = NarrowByField v0, v5 key="length"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = ElemGet v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_5]] site=[[w_9]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = NarrowByField v0, v10 key="length"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_5]] site=[[w_7]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]]}, {type=undefined|null|[[L_10]] site=[[w_12]]}, {type=undefined|null|[[L_10]] site=[[w_13]]}] results=[{type=undefined|null|[[L_10]] site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]], v1: undefined|null|[[L_10]], v2: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_10]] site=[[w_15]]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewArray v1, v2 contents=undefined|null|[[L_10]]
// CHECK-NEXT: v5 = IteratorOpen v4
// CHECK-NEXT: Jump -> next b2(v3)
// CHECK-NEXT: b2(v6: undefined|null|[[L_10]]):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = IteratorResume v5
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Convert v6 declared={type=undefined|null|[[L_10]] site=[[w_14]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|[[L_10]] site=[[w_16]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v5:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Filled"
// CHECK-NEXT: v2 = Construct v1 calleeName="Filled"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_17]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_21]]
// CHECK-NEXT: v5 = Call v4, -, v3 calleeName="handOver"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Filled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_17]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_17]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_22]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
