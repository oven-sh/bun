// RUN: lower
// OPTIONS: builtin-modules
// `named` and `star` read one variable of the other file, `byDefault` and `once` another.
// CHECK: [[namedRead]] = GetModuleVariable variable=[[second]]
// CHECK-NEXT: CheckInitialized [[namedRead]] name="named"
// CHECK-NEXT: [[defaultRead]] = GetModuleVariable variable=[[first]]
// CHECK-NEXT: CheckInitialized [[defaultRead]] name="byDefault"
// CHECK-NEXT: [[starRead]] = GetModuleVariable variable=[[second]]
// CHECK-NEXT: CheckInitialized [[starRead]] name="star"
// CHECK-NEXT: [[onceRead]] = GetModuleVariable variable=[[first]]
// CHECK-NEXT: CheckInitialized [[onceRead]] name="once"

// RUN(DISTINCT): lower
// DISTINCT: GetModuleVariable variable=[[second]]
// DISTINCT-NEXT: name="named"
// DISTINCT-NOT: variable=[[second]]
// DISTINCT: name="byDefault"

// FILE: main.ts
// @ts-nocheck
// `bun run` drops an import whose name is imported again further down.
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
