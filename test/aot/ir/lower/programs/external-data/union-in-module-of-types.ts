// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A generic union that is declared in a types-only module (`import type`), created in a generic async function and read at one instantiation.
import type * as Types from "./types";
declare const console: { log(...values: unknown[]): void };
async function either<In, Result>(act: Types.Act<In>, chain: Promise<Result>): Promise<Types.Either<In, Result>> {
  await Promise.race([act.early, chain.then(() => undefined, () => undefined)]);
  if (act.isEarly()) {
    return { early: await act.early };
  }
  return { late: await chain };
}
type Entering = { text: string; extra?: readonly string[] };
type Answer = { drop?: string };
async function use(has: boolean): Promise<string> {
  const act: Types.Act<Entering> = { early: has ? Promise.resolve({ text: 'in' }) : new Promise<Entering>(() => {}), isEarly: () => has };
  const first = await either(act, Promise.resolve<Answer>({ drop: 'why' }));
  if (first.early) {
    const early = first.early;
    return 'early ' + early.text;
  }
  const late = first.late;
  return 'late ' + late.drop;
}
use(true).then(a => use(false).then(b => console.log(a, '|', b)));
const alike = JSON.parse('{"early":"s"}') as { early: string }; console.log(alike.early);

// FILE: types.ts
export type Either<In, Result> = { early: In; late?: undefined } | { late: Result; early?: undefined };
export type Act<In> = { early: Promise<In>; isEarly(): boolean };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: either isEarly
// CHECK-LABEL: function {{*}}name="either"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Promise<undefined|null|[[L_3]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|[[L_4]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]], v2: undefined|null|Promise<undefined|null|[[L_3]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="Promise" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="race"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(PromiseRace) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v1 key="early"
// CHECK-NEXT: v9 = PropGet v2 key="then"
// CHECK-NEXT: v10 = NewClosure function=[[f_5]]
// CHECK-NEXT: v11 = NewClosure function=[[f_6]]
// CHECK-NEXT: v12 = Call v9, v2, v10, v11 calleeKey="then" calleeName="chain.then"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Promise<undefined> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = NewArray v8, v13 contents=undefined|null|Promise<undefined|null|[[L_7]]>
// CHECK-NEXT: v15 = Call v7, v5, v14 calleeKey="race" calleeName="Promise.race"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = Await v16, v1, v2
// CHECK-NEXT: v18 = PropGet v1 key="isEarly"
// CHECK-NEXT: v19 = Call v18, v1 calleeKey="isEarly" calleeName="act.isEarly"
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean site=[[w_8]]}
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: Branch v21 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v22):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v23 = PropGet v1 key="early"
// CHECK-NEXT: v24 = Await v23, v1, v2
// CHECK-NEXT: v25 = NewObject -, v24 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v26 = FinishObject v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|object site=[[w_10]]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: b4(v28):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = Await v2, v1, v2
// CHECK-NEXT: v30 = NewObject -, v29 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v31 = FinishObject v30
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|object site=[[w_10]]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=boolean site=[[w_12]]}] thisType={type=anything} results=[{type=boolean site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean site=[[w_13]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
