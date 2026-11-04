// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
import { visitors, type Visitors } from "./visitors";
type Everything = Parameters<Visitors[keyof Visitors]>[0] extends infer P ? P : never;
const all = { shared: { value: 100, children: [{ value: 1 }] }, own0: { value: { k0: 0 } }, own1: { value: { k1: 1 } }, own2: { value: { k2: 2 } }, own3: { value: { k3: 3 } }, own4: { value: { k4: 4 } }, own5: { value: { k5: 5 } }, own6: { value: { k6: 6 } }, own7: { value: { k7: 7 } }, own8: { value: { k8: 8 } }, own9: { value: { k9: 9 } }, own10: { value: { k10: 10 } }, own11: { value: { k11: 11 } }, own12: { value: { k12: 12 } }, own13: { value: { k13: 13 } }, own14: { value: { k14: 14 } }, own15: { value: { k15: 15 } }, own16: { value: { k16: 16 } }, own17: { value: { k17: 17 } }, own18: { value: { k18: 18 } }, own19: { value: { k19: 19 } } };
function visit(name: keyof Visitors): number {
  const visitor = visitors[name];
  return visitor(all);
}
let sum = 0;
for (const name of Object.keys(visitors) as (keyof Visitors)[]) sum += visit(name);
const one: Everything = all;
console.log(sum, visit("v7"), one.shared.children?.length);

// FILE: visitors.ts
export interface Tree<T> { value: T; children?: Tree<T>[]; up?: Tree<T> }
export interface Q0 { shared: Tree<number>; own0: Tree<{ k0: number; next?: Q0 }> }
export interface Q1 { shared: Tree<number>; own1: Tree<{ k1: number; next?: Q1 }> }
export interface Q2 { shared: Tree<number>; own2: Tree<{ k2: number; next?: Q2 }> }
export interface Q3 { shared: Tree<number>; own3: Tree<{ k3: number; next?: Q3 }> }
export interface Q4 { shared: Tree<number>; own4: Tree<{ k4: number; next?: Q4 }> }
export interface Q5 { shared: Tree<number>; own5: Tree<{ k5: number; next?: Q5 }> }
export interface Q6 { shared: Tree<number>; own6: Tree<{ k6: number; next?: Q6 }> }
export interface Q7 { shared: Tree<number>; own7: Tree<{ k7: number; next?: Q7 }> }
export interface Q8 { shared: Tree<number>; own8: Tree<{ k8: number; next?: Q8 }> }
export interface Q9 { shared: Tree<number>; own9: Tree<{ k9: number; next?: Q9 }> }
export interface Q10 { shared: Tree<number>; own10: Tree<{ k10: number; next?: Q10 }> }
export interface Q11 { shared: Tree<number>; own11: Tree<{ k11: number; next?: Q11 }> }
export interface Q12 { shared: Tree<number>; own12: Tree<{ k12: number; next?: Q12 }> }
export interface Q13 { shared: Tree<number>; own13: Tree<{ k13: number; next?: Q13 }> }
export interface Q14 { shared: Tree<number>; own14: Tree<{ k14: number; next?: Q14 }> }
export interface Q15 { shared: Tree<number>; own15: Tree<{ k15: number; next?: Q15 }> }
export interface Q16 { shared: Tree<number>; own16: Tree<{ k16: number; next?: Q16 }> }
export interface Q17 { shared: Tree<number>; own17: Tree<{ k17: number; next?: Q17 }> }
export interface Q18 { shared: Tree<number>; own18: Tree<{ k18: number; next?: Q18 }> }
export interface Q19 { shared: Tree<number>; own19: Tree<{ k19: number; next?: Q19 }> }
export type Visitors = {
  v0: (q: Q0) => number;
  v1: (q: Q1) => number;
  v2: (q: Q2) => number;
  v3: (q: Q3) => number;
  v4: (q: Q4) => number;
  v5: (q: Q5) => number;
  v6: (q: Q6) => number;
  v7: (q: Q7) => number;
  v8: (q: Q8) => number;
  v9: (q: Q9) => number;
  v10: (q: Q10) => number;
  v11: (q: Q11) => number;
  v12: (q: Q12) => number;
  v13: (q: Q13) => number;
  v14: (q: Q14) => number;
  v15: (q: Q15) => number;
  v16: (q: Q16) => number;
  v17: (q: Q17) => number;
  v18: (q: Q18) => number;
  v19: (q: Q19) => number;
};
export const visitors: Visitors = {
  v0: q => q.shared.value + q.own0.value.k0,
  v1: q => q.shared.value + q.own1.value.k1,
  v2: q => q.shared.value + q.own2.value.k2,
  v3: q => q.shared.value + q.own3.value.k3,
  v4: q => q.shared.value + q.own4.value.k4,
  v5: q => q.shared.value + q.own5.value.k5,
  v6: q => q.shared.value + q.own6.value.k6,
  v7: q => q.shared.value + q.own7.value.k7,
  v8: q => q.shared.value + q.own8.value.k8,
  v9: q => q.shared.value + q.own9.value.k9,
  v10: q => q.shared.value + q.own10.value.k10,
  v11: q => q.shared.value + q.own11.value.k11,
  v12: q => q.shared.value + q.own12.value.k12,
  v13: q => q.shared.value + q.own13.value.k13,
  v14: q => q.shared.value + q.own14.value.k14,
  v15: q => q.shared.value + q.own15.value.k15,
  v16: q => q.shared.value + q.own16.value.k16,
  v17: q => q.shared.value + q.own17.value.k17,
  v18: q => q.shared.value + q.own18.value.k18,
  v19: q => q.shared.value + q.own19.value.k19,
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="visitors"
// CHECK-NEXT: v10 = Call v7, v6, v9 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|"v0"|"v1"|"v10"|"v11"|"v12"|"v13"|"v14"|"v15"|"v16"|"v17"|"v18"|"v19"|"v2"|"v3"|"v4"|"v5"|"v6"|"v7"|"v8"|"v9"> flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v13 = IteratorOpen v12
// CHECK-NEXT: Jump -> next b1(v5)
// CHECK-NEXT: b1(v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = IteratorResume v13
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v19 = Convert v2 declared={type=undefined|null|[[L_5]]|[[L_6]]|[[L_7]]|[[L_8]]|[[L_9]]|[[L_10]]|[[L_11]]|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]]|[[L_17]]|[[L_18]]|[[L_19]]|[[L_20]]|[[L_21]]|[[L_22]]|[[L_23]]|[[L_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = String string="v7"
// CHECK-NEXT: v26 = Call v1, -, v25 calleeName="visit"
// CHECK-NEXT: v27 = PropGet v19 key="shared"
// CHECK-NEXT: v28 = PropGet v27 key="children"
// CHECK-NEXT: v29 = TypeTest v28 testedType=undefined|null
// CHECK-NEXT: Branch v29 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v30):
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b4(v32):
// CHECK-NEXT: v33 = PropGet v32 key="length"
// CHECK-NEXT: Jump -> next b5(v33)
// CHECK-NEXT: b5(v34):
// CHECK-NEXT: v35 = Call v24, v22, v14, v26, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: v37 = Call v1, -, v18 calleeName="visit"
// CHECK-NEXT: v38 = Add v14, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v39)
// CHECK-NEXT: b8() role=IterationCleanup subject=v13:
// CHECK-NEXT: v40 = CatchException
// CHECK-NEXT: IteratorClose v13 completion=Throw
// CHECK-NEXT: Rethrow v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"v0"|"v1"|"v10"|"v11"|"v12"|"v13"|"v14"|"v15"|"v16"|"v17"|"v18"|"v19"|"v2"|"v3"|"v4"|"v5"|"v6"|"v7"|"v8"|"v9" flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|"v0"|"v1"|"v10"|"v11"|"v12"|"v13"|"v14"|"v15"|"v16"|"v17"|"v18"|"v19"|"v2"|"v3"|"v4"|"v5"|"v6"|"v7"|"v8"|"v9"):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="visitors"
// CHECK-NEXT: v3 = ElemGet v2, v0
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="all"
// CHECK-NEXT: v6 = Call v3, -, v5 calleeName="visitor"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
