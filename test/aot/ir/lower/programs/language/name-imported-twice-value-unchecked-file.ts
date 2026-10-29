// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2300 6

// FILE: main.ts
// @ts-nocheck
// Each of the first three names is imported twice as a value, so it is declared twice in one scope. One import of the last pair is gone when the program runs.
import { first as named } from "./other";
import { second as named } from "./other";
import byDefault from "./other";
import { first as byDefault } from "./other";
import * as star from "./other";
import { second as star } from "./other";
import type { OnlyAType as once } from "./other";
import { first as once } from "./other";
console.log(named, byDefault, star, once);

// FILE: other.ts
export const first = "first";
export const second = "second";
export interface OnlyAType {
  a: number;
}
export default "the default";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
