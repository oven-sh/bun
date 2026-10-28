// The package.json of each package names a CommonJS file as "main" and an ES module as "module". One package is only imported: by a statement, through
// `export { } from` and by `import()`. One is only required. One is imported and required.
import { which as imported } from "only-imported";
import { which as handedOn } from "./barrel.mjs";
import { which as both } from "imported-and-required";
import { onlyRequired, required } from "./requires.cjs";

console.log(imported, handedOn, (await import("only-imported")).which);
console.log(onlyRequired);
console.log(both, required, (await import("imported-and-required")).which);
