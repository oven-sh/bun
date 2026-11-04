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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="singleOrUndefined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = NarrowByField v0, v4 key="length"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByField v0, v8 key="length"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = NewArray v1, v2 contents=anything
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1(v0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: Jump -> next b1(v9)
// CHECK-NEXT: b5() role=IterationCleanup subject=v4:
// CHECK-NEXT: v10 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Filled"
// CHECK-NEXT: v2 = Construct v1 calleeName="Filled"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = Call v4, -, v3 calleeName="handOver"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Filled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
