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
