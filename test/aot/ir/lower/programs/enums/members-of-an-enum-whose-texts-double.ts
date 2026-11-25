// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
import { Text } from "./enums";
console.log(Text.T0, Text.T3.length, Text.T10.length, Text.T12.length, Text.T13.length, Text.T16.length);

// FILE: enums.ts
export enum Text {
  T0 = "0123456789abcdef",
  T1 = T0 + T0,
  T2 = T1 + T1,
  T3 = T2 + T2,
  T4 = T3 + T3,
  T5 = T4 + T4,
  T6 = T5 + T5,
  T7 = T6 + T6,
  T8 = T7 + T7,
  T9 = T8 + T8,
  T10 = T9 + T9,
  T11 = T10 + T10,
  T12 = T11 + T11,
  T13 = T12 + T12,
  T14 = T13 + T13,
  T15 = T14 + T14,
  T16 = T15 + T15,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
