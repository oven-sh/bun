// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Enums of the program are made of constants that a declaration file declares with members of its enums for their values. One of those enums names its own members by a path.
import { least, most } from "./limits.js";
enum Size {
  Small = least,
  Large = most,
}
console.log(Size.Small, Size.Large, Size[Size.Small], Size[Size.Large]);

// FILE: limits.d.ts
export declare enum Lower {
  Least = 1,
}
export declare enum Upper {
  Step = 4,
  Most = Upper.Step << 2,
}
export declare const least = Lower.Least;
export declare const most = Upper.Most;

// FILE: limits.js
export const least = 1;
export const most = 16;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="least"
// CHECK-NEXT: PropSet v2, v4 key="Small"
// CHECK-NEXT: v6 = ToPropertyKey v4
// CHECK-NEXT: v7 = String string="Small"
// CHECK-NEXT: ElemSet v2, v6, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="most"
// CHECK-NEXT: PropSet v2, v10 key="Large"
// CHECK-NEXT: v12 = ToPropertyKey v10
// CHECK-NEXT: v13 = String string="Large"
// CHECK-NEXT: ElemSet v2, v12, v13
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v2 key="Small"
// CHECK-NEXT: v21 = PropGet v2 key="Large"
// CHECK-NEXT: v22 = PropGet v2 key="Small"
// CHECK-NEXT: v23 = ElemGet v2, v22
// CHECK-NEXT: v24 = PropGet v2 key="Large"
// CHECK-NEXT: v25 = ElemGet v2, v24
// CHECK-NEXT: v26 = Call v19, v17, v20, v21, v23, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
