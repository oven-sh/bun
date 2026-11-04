// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Nothing is left of shims.ts at run time, so whether it is a script is a question for the checker alone: `declare module` in it declares a module and adds to none, and its interface is global, as for tsc and `bun check`.
import "./shims";
import { third } from "untyped-thirds";
import thing from "./one.thing";

const size: Size = { width: 9 };
console.log(third(size.width), typeof thing);

// FILE: node_modules/untyped-thirds/index.js
exports.third = n => n / 3;

// FILE: node_modules/untyped-thirds/package.json
{ "name": "untyped-thirds", "version": "1.0.0", "main": "index.js" }

// FILE: one.thing
thing
// FILE: shims.ts
interface Size {
  width: number;
}
declare module "untyped-thirds" {
  export function third(n: number): number;
}
declare module "*.thing" {
  const path: string;
  export default path;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": false, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v1 key="width"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="third"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="thing"
// CHECK-NEXT: v14 = TypeOf v13
// CHECK-NEXT: v15 = Call v6, v4, v11, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
