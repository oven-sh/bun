// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// An enum made of an enum made of an enum that was stored to.
import "./spoil";
import { Made } from "./made";
import { Third } from "./third";

console.log(Made.Three, Made.Four, Third.Eight);

// FILE: base.ts
export enum Base {
  One = 1,
  Two,
}

// FILE: made.ts
import { Base } from "./base";

export enum Made {
  Three = Base.One + Base.Two,
  Four = Three + 1,
}

// FILE: spoil.ts
import { Base } from "./base";

(Base as Record<string, unknown>).One = 100;

// FILE: third.ts
import { Made } from "./made";

export enum Third {
  Eight = Made.Four * 2,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="Made"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v8 = PropGet v7 key="Three"
// CHECK-NEXT: v9 = Convert v8 declared={type=3 site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="Made"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v13 = PropGet v12 key="Four"
// CHECK-NEXT: v14 = Convert v13 declared={type=4 site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="Third"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v18 = PropGet v17 key="Eight"
// CHECK-NEXT: v19 = Convert v18 declared={type=8 site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = Call v4, v2, v9, v14, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
