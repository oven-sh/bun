// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2440 4

// FILE: main.ts
// @ts-nocheck
// `bun run` says of the last import of each name that the name has already been declared.
import { first as between } from "./other";
const between = "mine";
import { second as between } from "./other";
import required = require("./other");
import { first as required } from "./other";
namespace space {
  export const inner = "mine";
}
import entity = space.inner;
import { first as entity } from "./other";
import { first as again } from "./other";
import again = require("./other");
import { second as again } from "./other";
console.log(between, required, entity, again);

// FILE: other.ts
export const first = "first";
export const second = "second";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
