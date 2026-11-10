// RUN: link
// CHECK: module [[fills]] path="{{*}}fills.ts"
// CHECK: module [[index]] path="{{*}}index.ts" {{*}}requests=[{target=[[fills]] completes=true}]
// CHECK: module {{*}}main.ts" {{*}}requests=[{target=[[index]] completes=true}]
// CHECK: PropSet {{*}}key="filled"
// CHECK: = Integer integer=7

// FILE: main.ts
import { E } from "pkg";
console.log(E.A);

// FILE: node_modules/pkg/package.json
{ "name": "pkg", "type": "module", "exports": "./index.ts", "sideEffects": false }

// FILE: node_modules/pkg/index.ts
export { E } from "./fills.ts";

// FILE: node_modules/pkg/fills.ts
import { Y } from "./y.ts";
(globalThis as any).filled = true;
export enum E {
  A = Y.A + 1,
}

// FILE: node_modules/pkg/y.ts
export enum Y {
  A = 6,
}
