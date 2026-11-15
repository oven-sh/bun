// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 17
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="describe"

// FILE: main.js
// `export *` of an ES module and of a CommonJS module that export the same name: the name is ambiguous, so importing it is a SyntaxError and the namespace object does not have it. A local export wins, a name that reaches one binding on two paths is not ambiguous, and a module reached on two paths counts on each.
async function attempt(label, run) {
  try {
    console.log(label + ":", await run());
  } catch (error) {
    console.log(label + ":", error.constructor.name, error.message.replace(/'[^']*[\\/]([^'\\/]+)'/g, "'$1'"));
  }
}
const describe = namespace => [Object.keys(namespace).join(), "both" in namespace, namespace.both, namespace.onlyDynamic];

await attempt("names in one module only", async () => (await import("./imports-unambiguous.mjs")).seen);
await attempt("name in both", () => import("./imports-both.mjs"));
await attempt("name in both again", () => import("./imports-both.mjs"));
await attempt("name in both, one level up", () => import("./imports-both-from-outer.mjs"));
await attempt("namespace", async () => describe(await import("./stars.mjs")));
await attempt("namespace one level up", async () => describe(await import("./outer.mjs")));
await attempt("local export wins", async () => describe(await import("./shadows.mjs")));
await attempt("local export wins by name", async () => (await import("./imports-shadowed.mjs")).seen);
await attempt("hidden on one of two paths", async () => describe(await import("./diamond.mjs")));
await attempt("hidden on one of two paths by name", () => import("./imports-from-diamond.mjs"));
await attempt("star cycle", async () => describe(await import("./star-cycle-b.mjs")));

// FILE: deep.mjs
export * from "./dynamic.cjs";

// FILE: diamond.mjs
export * from "./hides.mjs";
export * from "./passes.mjs";

// FILE: dynamic.cjs
exports.both = "both from dynamic";
exports.onlyDynamic = "only dynamic";
exports.shared = "shared";

// FILE: hides.mjs
export * from "./deep.mjs";
export const onlyDynamic = "only dynamic from hides";

// FILE: imports-both-from-outer.mjs
import { both } from "./outer.mjs";
console.log("imports-both-from-outer runs", both);

// FILE: imports-both.mjs
import { both } from "./stars.mjs";
console.log("imports-both runs", both);

// FILE: imports-from-diamond.mjs
import { onlyDynamic } from "./diamond.mjs";
console.log("imports-from-diamond runs", onlyDynamic);

// FILE: imports-shadowed.mjs
import { both, onlyDynamic } from "./shadows.mjs";
export const seen = [both, onlyDynamic];

// FILE: imports-unambiguous.mjs
import { onlyStatic, onlyDynamic, shared } from "./stars.mjs";
export const seen = [onlyStatic, onlyDynamic, shared];

// FILE: outer.mjs
export * from "./stars.mjs";

// FILE: passes.mjs
export * from "./deep.mjs";

// FILE: shadows.mjs
export * from "./stars.mjs";
export const both = "both from shadows";

// FILE: star-cycle-a.mjs
export * from "./star-cycle-b.mjs";
export * from "./dynamic.cjs";

// FILE: star-cycle-b.mjs
export * from "./star-cycle-a.mjs";
export const fromB = "from b";

// FILE: stars.mjs
export * from "./static.mjs";
export * from "./dynamic.cjs";

// FILE: static.mjs
export const both = "both from static";
export const onlyStatic = "only static";
export { shared } from "./dynamic.cjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
