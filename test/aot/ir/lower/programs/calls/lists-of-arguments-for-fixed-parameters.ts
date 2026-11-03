// RUN: lower
// OPTIONS: builtin-modules

// f(...list), f.apply(t, list), new C(...list) and super(...list) where no callee can count its arguments, beside the neighbors in which somebody can tell:
// a callee that reads arguments or collects the rest, a list with an accessor, a hole or a prototype of its own, a list that is shorter or longer than the parameters,
// a list too long for the stack.
const log: string[] = [];

function two(a?: unknown, b?: unknown): string {
  return `two(${String(a)}, ${String(b)})`;
}
function withDefault(a: unknown, b: unknown = "default"): string {
  return `withDefault(${String(a)}, ${String(b)})`;
}
function counts(this: unknown, _a?: unknown): string {
  return `counts(${arguments.length})`;
}
function collects(first?: unknown, ...others: unknown[]): string {
  return `collects(${String(first)}; ${others.join("|")})`;
}
function usesThis(this: { name: string }, a?: unknown): string {
  return `${this.name}(${String(a)})`;
}

function forward(...list: unknown[]): string {
  return two(...list);
}
function forwardToDefault(...list: unknown[]): string {
  return withDefault(...(list as [unknown, unknown]));
}
function forwardToCounting(...list: unknown[]): string {
  return counts(...list);
}
function forwardToCollecting(...list: unknown[]): string {
  return collects(...list);
}
function applies(self: { name: string }, list: unknown[]): string {
  return usesThis.apply(self, list as [unknown]);
}
function oneOfTwo(pick: boolean, list: unknown[]): string {
  const callee = pick ? two : withDefault;
  return callee(...(list as [unknown, unknown]));
}
function oneOfTwoMayCount(pick: boolean, list: unknown[]): string {
  const callee = pick ? two : counts;
  return callee(...list);
}

class Base {
  x: unknown;
  y: unknown;
  constructor(x?: unknown, y?: unknown) {
    this.x = x;
    this.y = y;
  }
  show(): string {
    return `${this.constructor.name}(${String(this.x)}, ${String(this.y)})`;
  }
}
class Implicit extends Base {}
class Forwards extends Base {
  extra: number;
  constructor(...list: unknown[]) {
    super(...list);
    this.extra = list.length;
  }
}
class CountingBase {
  count: number;
  constructor(..._list: unknown[]) {
    this.count = arguments.length;
  }
}
class ForwardsToCounting extends CountingBase {
  constructor(...list: unknown[]) {
    super(...list);
  }
}
class ForwardsOneList extends Base {
  constructor(list: unknown[]) {
    super(...list);
  }
}
function constructs(list: unknown[]): string {
  return new Base(...list).show();
}
function outcome(run: () => string): string {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}
function filled(length: number): unknown[] {
  return new Array(length).fill(7);
}

function listWithAccessor(): unknown[] {
  const list: unknown[] = [1, 2, 3];
  Object.defineProperty(list, 2, { get() { log.push("third element read"); return 3; } });
  return list;
}
function listWithHole(): unknown[] {
  // eslint-disable-next-line no-sparse-arrays
  return [, "after the hole"];
}
class OddList extends Array<unknown> {
  *[Symbol.iterator](): ArrayIterator<unknown> {
    log.push("own iterator");
    yield "from the iterator";
  }
}

const self = { name: "self" };
const three: unknown[] = [1, 2, 3];
for (let round = 0; round < 3; round++) {
  console.log(forward(), forward(1), forward(1, 2), forward(1, 2, 3), forward(undefined, null));
  console.log(forwardToDefault(1), forwardToDefault(1, undefined), forwardToDefault(1, 2, 3));
  console.log(forwardToCounting(), forwardToCounting(1, 2, 3));
  console.log(forwardToCollecting(), forwardToCollecting(1), forwardToCollecting(1, 2, 3));
  console.log(applies(self, []), applies(self, ["a"]), applies(self, ["a", "b"]));
  console.log(oneOfTwo(true, [1]), oneOfTwo(false, [1]), oneOfTwo(round === 1, [1, 2, 3]));
  console.log(oneOfTwoMayCount(true, [1, 2, 3]), oneOfTwoMayCount(false, [1, 2, 3]));
  console.log(new Implicit().show(), new Implicit(1).show(), new Implicit(...(three as [unknown, unknown])).show());
  console.log(new Forwards().show(), new Forwards(1, 2, 3).show(), new Forwards(1, 2, 3).extra);
  console.log(new ForwardsToCounting().count, new ForwardsToCounting(1, 2, 3).count);
  console.log(constructs([]), constructs([1]), constructs([1, 2, 3]));
  console.log(two(...listWithAccessor()), two.apply(null, listWithAccessor() as [unknown, unknown]), log.splice(0).join(","));
  console.log(two(...listWithHole()), two.apply(null, listWithHole() as [unknown, unknown]), constructs(listWithHole()));
  console.log(two(...new OddList(1, 2)), two.apply(null, new OddList(1, 2) as unknown as [unknown, unknown]), log.splice(0).join(","));
  for (const length of [1000, 65535, 65536, 700000, 2 ** 21]) {
    const list = filled(length);
    console.log(
      length,
      outcome(() => two(...list)),
      outcome(() => two.apply(null, list as [unknown, unknown])),
      outcome(() => constructs(list)),
      outcome(() => new ForwardsOneList(list).show()),
    );
  }
}

// GENERATED: counts forward filled ForwardsToCounting [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="counts"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = String string="counts("
// CHECK-NEXT: v6 = PropGet v4 key="length"
// CHECK-NEXT: v7 = ToString v6
// CHECK-NEXT: v8 = String string=")"
// CHECK-NEXT: v9 = Strcat v5, v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="forward"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_3]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v2, v0
// CHECK-NEXT: v4 = CallList v1, -, v2 calleeName="two"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="filled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=undefined|null|Array site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=7
// CHECK-NEXT: v2 = Builtin builtin=CompilerHelpersFilledArray [isNotReadFromHolder]
// CHECK-NEXT: v3 = Call v2, -, v0, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ForwardsToCounting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_10]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v5, v2
// CHECK-NEXT: v7 = SuperConstructList v4, v1, v5 layout=[[L_12]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = TypeTest v14 testedType=undefined
// CHECK-NEXT: Branch v15 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = TypeTest v8 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: b9(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=DerivedConstructorResult name="ForwardsToCounting"
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b10(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_13]] site=[[w_14]]} results=[{type=undefined|null|[[L_15]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_13]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="own iterator"
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_17]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = String string="from the iterator"
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
