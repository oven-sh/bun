// A mock that comes before a module is loaded stands for the whole module. The build has found every name below, and the link of each importer looks whether a mock has left it out.
// OPTIONS: builtin-modules
// RUN(IMPORT): link
// IMPORT: module {{*}}displayPath="reader.ts" {{*}}requiredNames=[{module=[[shapes]] name="sides" mayBeAbsent=true}]

// RUN(EXPORT): link
// EXPORT: module {{*}}displayPath="hands-on.ts" {{*}}requiredNames=[{module=[[shapes]] name="sides" mayBeAbsent=true exportName="corners" specifier="./shapes"}]

// The error names the module that the import is written from.
// RUN(STAR): link
// STAR: module {{*}}displayPath="reader-through-star.ts" {{*}}requiredNames=[{module=[[all]] name="sides" mayBeAbsent=true}]

// RUN(OTHER): link
// OTHER: module {{*}}displayPath="reader-of-another-file.ts"
// OTHER-NOT: requiredNames
// OTHER: module

// FILE: main.ts
import { mock } from "bun:test";
mock.module("./shapes", () => ({}));
console.log(await import("./reader"), await import("./hands-on"), await import("./reader-through-star"), await import("./reader-of-another-file"));

// FILE: shapes.ts
export const sides = 4;

// FILE: all.ts
export * from "./shapes";

// FILE: colors.ts
export const red = 1;

// FILE: reader.ts
import { sides } from "./shapes";
console.log(sides);

// FILE: hands-on.ts
export { sides as corners } from "./shapes";

// FILE: reader-through-star.ts
import { sides } from "./all";
console.log(sides);

// FILE: reader-of-another-file.ts
import { red } from "./colors";
console.log(red);
