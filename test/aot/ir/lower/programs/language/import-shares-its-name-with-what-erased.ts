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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = String string="mine"
// CHECK-NEXT: v3 = String string="mine"
// CHECK-NEXT: v4 = Data data=[[d_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v1 calleeName="Alias"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="described"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="overloaded"
// CHECK-NEXT: v16 = Call v15 calleeName="overloaded"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = PropGet v5 key="a"
// CHECK-NEXT: v19 = Call v10, v8, v2, v11, v3, v13, v17, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Alias"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="mine"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
