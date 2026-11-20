// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Each constant, class and enum of values.ts is named in its own file only by the export that hands it out. It is used here once, each through another kind of export and import. Beside each stands one that nobody imports.
import byDefault, { direct, renamed, "quoted name" as quoted, Klass, Kind, fromPattern, fromArray } from "./values";
import { viaStar, viaNamedBarrel, inner } from "./barrel";
import * as values from "./values";
import viaImportEquals = require("./values");

console.log(byDefault.kind, direct, renamed, quoted, new Klass().name(), Kind.A, fromPattern, fromArray);
console.log(viaStar, viaNamedBarrel, inner.viaNamespaceExport);
console.log(values.viaNamespace, viaImportEquals.viaImportEquals, require("./values").viaRequire, (await import("./values")).viaImportCall);

// FILE: barrel.ts
export * from "./values";
export { forNamedBarrel as viaNamedBarrel } from "./values";
export * as inner from "./values";

// FILE: values.ts
export const direct = "direct";
export const directUnused = "unused";
const local = "renamed";
const localUnused = "unused";
export { local as renamed, localUnused as renamedUnused };
const spaced = "quoted";
export { spaced as "quoted name" };
export class Klass { name() { return "Klass"; } }
export class KlassUnused {}
export enum Kind { A = "a" }
export enum KindUnused { A = "a" }
export const { fromPattern, fromPatternUnused } = { fromPattern: "from a pattern", fromPatternUnused: 1 };
export const [fromArray] = ["from an array pattern"];
const theDefault = { kind: "default" };
export default theDefault;
export const viaStar = "through export *";
export const forNamedBarrel = "through a named re-export";
export const viaNamespaceExport = "through export * as";
export const viaNamespace = "through a namespace import";
export const viaImportEquals = "through import = require";
export const viaRequire = "through require";
export const viaImportCall = "through import()";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
