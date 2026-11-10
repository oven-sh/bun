// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: UnprovenInt32 10

// A `number` is held to the promise wherever the position it goes to is written `int32` after the types are worked out: a type argument that is inferred as `number`, a parameter that is a union or optional, a member of a mapped type, `typeof` of an int32, what `yield` gives and takes, a setter, a field that is only declared, `satisfies`. structural-types/an-int32-comes-out-of-generic-functions-and-classes and its neighbors have the ways that the build accepts.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
const n: number = given[0];
function same<T>(value: T): T { return value; }
const inferred: int32 = same(n);
function either(value: int32 | string): int32 { return typeof value === "number" ? value : 0; }
function maybe(value?: int32): int32 { return value ?? 0; }
type Ints<T> = { [K in keyof T]: int32 };
const mapped: Ints<{ a: string }> = { a: n };
const model: int32 = 1;
let likeTheModel: typeof model = n;
function* taking(): Generator<int32, void, int32> { const got: int32 = yield 1; console.log(got); }
function* giving(): Generator<int32, void, void> { yield n; }
class Counter {
  count: int32 = 0;
  declare never: int32;
  get size(): int32 { return this.count; }
  set size(value: int32) { this.count = value; }
}
const counter = new Counter();
counter.size = n;
const neverStored: int32 = counter.never;
const satisfied: int32 = n satisfies int32;

console.log(inferred, either(n), maybe(n), mapped, likeTheModel, taking().next(), giving().next(), counter, neverStored, satisfied);

// GENERATED: either taking giving Counter size
// CHECK-LABEL: function {{*}}name="either"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|i32|string flags=[IsInt32Promise, OmitsNull, OmitsUndefined]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: undefined|null|i32|string):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=i32}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="taking"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<i32> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=i32}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="giving"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<i32> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="n"
// CHECK-NEXT: v5 = Convert v4 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Convert v1 declared={type=i32}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_2]]} parameters=[{type=i32 flags=[IsInt32Promise]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: i32):
// CHECK-NEXT: v2 = Convert v1 declared={type=i32}
// CHECK-NEXT: PropSet v0, v2 key="count"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
