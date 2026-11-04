// RUN: lower
// OPTIONS: builtin-modules

// Sources of a spread: `f(...x)`, `[...x]`, `new Set(x)`, Array.from and Promise.all use the Symbol.iterator method of an Array subclass, which yields strings though the class says number.
export {};

let total = 0;

class Odd extends Array<number> {
  *[Symbol.iterator](): ArrayIterator<number> {
    total += 1;
    for (let i = 0; i < this.length; i++) yield (i % 2 ? String(this[i]) : this[i]) as number;
  }
}

function sum(a: number, b: number, c: number): number | string {
  total += (typeof a === "number" ? 100 : 10000) + (typeof b === "number" ? 100 : 10000) + (typeof c === "number" ? 100 : 10000);
  return a + b + c;
}

const odd = new Odd();
odd.push(1, 2, 3);
sum(1, 2, 3);
const results: unknown[] = [sum(...(odd as unknown as [number, number, number])), [...odd].map(one => typeof one), new Set(odd).has(2), Array.from(odd)[1] === 2, Math.max(...odd), ((await Promise.all(odd)) as any).map((one: unknown) => typeof one), Array.from(odd.concat([4]), one => typeof one).join("/")];
const [, second] = odd;
console.log(total, results.join(), typeof second);

// GENERATED: Odd [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_1]]} results=[{type=undefined|null|[[L_2]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="total"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="total"
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_3]]
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12)
// CHECK-NEXT: b1(v13: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = PropGet v0 key="length"
// CHECK-NEXT: v16 = Less v13, v15
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b9()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Integer integer=2
// CHECK-NEXT: v18 = Mod v13, v17
// CHECK-NEXT: v19 = ToBoolean v18
// CHECK-NEXT: Branch v19 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = Builtin builtin=String
// CHECK-NEXT: v22 = ElemGet v0, v13
// CHECK-NEXT: v23 = Call v21, -, v22 calleeName="String"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5(v24)
// CHECK-NEXT: b4(v25):
// CHECK-NEXT: v26 = ElemGet v0, v13
// CHECK-NEXT: Jump -> next b5(v26)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: v28 = Convert v27 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v29 = Yield v28
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: Switch v31 cases=[1, 2] -> case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b6():
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v30
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = Increment v13
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v33)
// CHECK-NEXT: b9():
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
