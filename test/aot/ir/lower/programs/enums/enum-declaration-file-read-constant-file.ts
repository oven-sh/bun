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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="least"
// CHECK-NEXT: v5 = Convert v4 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v5 key="Small"
// CHECK-NEXT: v7 = ToPropertyKey v5
// CHECK-NEXT: v8 = String string="Small"
// CHECK-NEXT: ElemSet v2, v7, v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="most"
// CHECK-NEXT: v12 = Convert v11 declared={type=16 flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v12 key="Large"
// CHECK-NEXT: v14 = ToPropertyKey v12
// CHECK-NEXT: v15 = String string="Large"
// CHECK-NEXT: ElemSet v2, v14, v15
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = Convert v2 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v22 key="Small"
// CHECK-NEXT: v24 = Convert v23 declared={type=1 site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v25 = PropGet v22 key="Large"
// CHECK-NEXT: v26 = Convert v25 declared={type=16 site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = PropGet v22 key="Small"
// CHECK-NEXT: v28 = Convert v27 declared={type=1 site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = ElemGet v22, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v31 = PropGet v22 key="Large"
// CHECK-NEXT: v32 = Convert v31 declared={type=16 site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v33 = ElemGet v22, v32
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v35 = Call v21, v19, v24, v26, v30, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
