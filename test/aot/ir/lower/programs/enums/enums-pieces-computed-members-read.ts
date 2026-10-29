// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Enums in pieces and with computed members are read from another file.
import { Bits, Fixed, Late, Parts, Uses } from "./enums";
console.log(
  Parts.A + Parts.B,
  Bits.A,
  Bits.B,
  Bits.C,
  Bits.D,
  Bits.E,
  Bits.F,
  Bits.G,
  Late.A > 0,
  Late.B,
  Late.C,
  Fixed.B,
  Uses.Y,
);

// FILE: enums.ts
export enum Parts {
  A = 1,
}
export enum Parts {
  B = 2,
}
export enum Bits {
  A = 1 << 0,
  B = 1 << 1,
  C = A | B,
  D = C * 2 + 1,
  E = ~A,
  F = "x".length,
  G = Bits.C + 1,
}
export enum Late {
  A = process.argv.length,
  B = 4,
  C,
}
export const enum Fixed {
  A = 3,
  B = A * 2,
}
export enum Uses {
  Y = Fixed.B + 1,
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
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Integer integer=3
// CHECK-NEXT: v11 = Integer integer=7
// CHECK-NEXT: v12 = Integer integer=-2
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Integer integer=4
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="Late"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v18 = PropGet v17 key="A"
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = Greater v19, v20
// CHECK-NEXT: v22 = Integer integer=4
// CHECK-NEXT: v23 = Integer integer=5
// CHECK-NEXT: v24 = Integer integer=6
// CHECK-NEXT: v25 = Integer integer=7
// CHECK-NEXT: v26 = Call v4, v2, v7, v8, v9, v10, v11, v12, v13, v14, v21, v22, v23, v24, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
