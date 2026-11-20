// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// barrel.ts declares `hidden` itself, so the one behind `export *` is not the one that is imported. `clash` comes from two stars, so the namespace does not have it. `same` comes from two stars but is one binding, so it is there.
import { hidden, same } from "./barrel";
import * as barrel from "./barrel";

console.log(hidden(), same());
console.log(Object.keys(barrel).join(), "clash" in barrel);

// FILE: barrel.js
export * from "./left";
export * from "./right";
export function hidden() { return "hidden of the barrel"; }

// FILE: left.js
export function hidden() { return "hidden of left"; }
export function clash() { return "clash of left"; }
export { same } from "./shared";

// FILE: right.js
export function clash() { return "clash of right"; }
export { same } from "./shared";

// FILE: shared.js
export function same() { return "same"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
