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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Integer integer=4
// CHECK-NEXT: v7 = Integer integer=8
// CHECK-NEXT: v8 = Call v4, v2, v5, v6, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
