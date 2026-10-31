// RUN: lower
// OPTIONS: builtin-modules
// CHECK: CheckInitialized {{*}} name="named"
// CHECK-NEXT: Convert {{*}} declared={type=undefined|null|"second"
// CHECK: CheckInitialized {{*}} name="byDefault"
// CHECK-NEXT: Convert {{*}} declared={type=undefined|null|"first"
// CHECK: CheckInitialized {{*}} name="star"
// CHECK-NEXT: Convert {{*}} declared={type=undefined|null|"second"
// CHECK: CheckInitialized {{*}} name="once"
// CHECK-NEXT: Convert {{*}} declared={type=undefined|null|"first"

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
