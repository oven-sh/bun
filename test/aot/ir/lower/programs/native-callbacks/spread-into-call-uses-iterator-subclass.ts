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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=undefined|null|[[L_3]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="total"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="total"
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_4]]
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b2(v13: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = Convert v13 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v0 key="length"
// CHECK-NEXT: v17 = Less v15, v16
// CHECK-NEXT: Branch v17 -> taken b3(| 0), notTaken b14(| 0)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Convert v18 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v20 = Integer integer=2
// CHECK-NEXT: v21 = Mod v19, v20
// CHECK-NEXT: v22 = ToBoolean v21
// CHECK-NEXT: Branch v22 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v23):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Builtin builtin=String
// CHECK-NEXT: v25 = ElemGet v0, v19
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|number site=[[w_7]]} illTypedCause=FromLooseType
// CHECK-NEXT: v27 = Call v24, -, v26 calleeName="String"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v30 = ElemGet v0, v19
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|number site=[[w_9]]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = Convert v32 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v34 = Yield v33
// CHECK-NEXT: v35 = ResultAt v34
// CHECK-NEXT: v36 = ResultAt v34 index=1
// CHECK-NEXT: Switch v36 cases=[1, 2] -> case b10(), case b11(), otherwise b12()
// CHECK-NEXT: b10():
// CHECK-NEXT: Throw v35
// CHECK-NEXT: b11():
// CHECK-NEXT: Return v35
// CHECK-NEXT: b12():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v37 = Increment v19
// CHECK-NEXT: v38 = Convert v37 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v38)
// CHECK-NEXT: b14(v39):
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
