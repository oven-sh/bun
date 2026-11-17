// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="Alias"

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
