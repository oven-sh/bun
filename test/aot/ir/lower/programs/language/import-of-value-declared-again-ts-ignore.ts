// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2440 9

// FILE: main.ts
// Each of these names is imported as a value and declared again. `// @ts-ignore` silences the type checker, and the name is still declared twice in one scope.
const enum ConstantEnum {
  A = "mine",
}
enum Enum {
  A = "mine",
}
const constant = "mine";
var variable = "mine";
function declared() {
  return "mine";
}
class Class {}
const byDefault = "mine";
const star = "mine";
// @ts-ignore
import { ConstantEnum } from "./other";
// @ts-ignore
import { Enum } from "./other";
// @ts-ignore
import { constant } from "./other";
// @ts-ignore
import { variable } from "./other";
// @ts-ignore
import { declared } from "./other";
// @ts-ignore
import { Class } from "./other";
// @ts-ignore
import byDefault from "./other";
// @ts-ignore
import * as star from "./other";
// @ts-ignore
import { below } from "./other";
const below = "mine";
console.log(ConstantEnum.A, Enum.A, constant, variable, declared(), typeof Class, byDefault, star, below);

// FILE: other.ts
export enum ConstantEnum {
  A = "from the other file",
}
export enum Enum {
  A = "from the other file",
}
export const constant = "from the other file";
export const variable = "from the other file";
export function declared() {
  return "from the other file";
}
export class Class {}
export const below = "from the other file";
export default "from the other file";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
