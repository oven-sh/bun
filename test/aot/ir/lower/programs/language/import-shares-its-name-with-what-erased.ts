// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// One declaration of each pair is gone when the program runs, so each name is declared once.
import { OnlyAType, Alias } from "./other";
// @ts-ignore
import type { value } from "./other";
// @ts-ignore
import { described } from "./other";
// @ts-ignore
import { overloaded } from "./other";
const OnlyAType = "mine";
function Alias() {
  return "mine";
}
const value = "mine";
declare const described: string;
declare function overloaded(): string;
const typed: OnlyAType = { a: 1 };
console.log(OnlyAType, Alias(), value, described, overloaded(), typed.a);

// FILE: other.ts
export interface OnlyAType {
  a: number;
}
export type Alias = string;
export const value = "from the other file";
export const described = "from the other file";
export function overloaded() {
  return "from the other file";
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = String string="mine"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"mine" site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = String string="mine"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"mine" site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Data data=[[d_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v1 calleeName="Alias"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="described"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="overloaded"
// CHECK-NEXT: v20 = Call v19 calleeName="overloaded"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = PropGet v7 key="a"
// CHECK-NEXT: v23 = Call v12, v10, v3, v14, v5, v17, v21, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Alias"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="mine"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
