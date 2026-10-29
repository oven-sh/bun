// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Each export of lib.ts is reached once, through the namespace import, and each time the name is written in another way.
import * as lib from "./lib";

console.log(lib.plain());
console.log(lib["quoted"]());
console.log(lib[`template`]());
console.log(lib?.optional());
console.log(lib.optionalCall?.());
console.log(lib!.nonNull());
console.log((lib as any).cast());
console.log((lib satisfies object).satisfied());
console.log((lib).parenthesized());
console.log((0, lib.comma)());
console.log(lib.viaCall.call(undefined));
console.log(lib.tag`x`);
console.log(new lib.Constructed().value());
console.log(typeof lib.onlyTypeof);
console.log(lib.onlyName.name, lib.onlyLength.length);

// FILE: lib.ts
export function plain() { return "plain"; }
export function quoted() { return "quoted"; }
export function template() { return "template"; }
export function optional() { return "optional"; }
export function optionalCall() { return "optional call"; }
export function nonNull() { return "non-null"; }
export function cast() { return "cast"; }
export function satisfied() { return "satisfied"; }
export function parenthesized() { return "parenthesized"; }
export function comma() { return "comma"; }
export function viaCall() { return "via call"; }
export function tag(strings: TemplateStringsArray) { return "tag " + strings[0]; }
export class Constructed {
  value() { return "constructed"; }
}
export function onlyTypeof() { return "only typeof"; }
export function onlyName() { return "only name"; }
export function onlyLength(a: number, b: number) { return "only length"; }
export function unused() { return "unused"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
