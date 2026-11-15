// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 18
// CHECK-LABEL: function {{*}}name="describe"

// FILE: main.js
// `export *` of two ES modules that export the same name: the name is ambiguous. `export *` of a CommonJS module that has the name too does not bring it back, so the namespace object has no such key. Two modules that export their own `import * as space` export two bindings, and two `export * as space` of one module export one.
import * as stars from "./stars.mjs";
import * as below from "./below.mjs";
import * as above from "./above.mjs";
import * as shadows from "./shadows.mjs";
import * as holders from "./holders.mjs";
import * as holdersAlone from "./holders-alone.mjs";
import * as named from "./named.mjs";

const describe = namespace => [
  Object.keys(namespace).join(),
  "both" in namespace,
  namespace.both,
  "space" in namespace,
  typeof namespace.space,
];

console.log("two ES modules and CommonJS:", describe(stars), stars.both, stars.onlyFirst, stars.onlyDynamic);
console.log("ambiguous one level down:", describe(below), below.both, below.onlySecond);
console.log("ambiguous one level up:", describe(above), above.both);
console.log("local export wins:", describe(shadows), shadows.both);
console.log("two imported namespaces and CommonJS:", describe(holders), holders.space);
console.log("two imported namespaces:", describe(holdersAlone), holdersAlone.space);
console.log("one namespace export twice:", describe(named), named.space.value);
console.log("by import():", describe(await import("./stars.mjs")), describe(await import("./static-stars.mjs")));

// FILE: above.mjs
export * from "./stars.mjs";

// FILE: below.mjs
export * from "./static-stars.mjs";
export * from "./dynamic.cjs";

// FILE: dynamic.cjs
exports.both = "both from dynamic";
exports.space = "space from dynamic";
exports.onlyDynamic = "only dynamic";

// FILE: first.mjs
export const both = "both from first";
export const onlyFirst = "only first";

// FILE: holders-alone.mjs
export * from "./holds-first.mjs";
export * from "./holds-second.mjs";
export * from "./other.cjs";

// FILE: holders.mjs
export * from "./holds-first.mjs";
export * from "./holds-second.mjs";
export * from "./dynamic.cjs";

// FILE: holds-first.mjs
import * as space from "./target.mjs";
export { space };

// FILE: holds-second.mjs
import * as space from "./target.mjs";
export { space };

// FILE: named.mjs
export * from "./names-first.mjs";
export * from "./names-second.mjs";
export * from "./other.cjs";

// FILE: names-first.mjs
export * as space from "./target.mjs";

// FILE: names-second.mjs
export * as space from "./target.mjs";

// FILE: other.cjs
exports.other = "other";

// FILE: second.mjs
export const both = "both from second";
export const onlySecond = "only second";

// FILE: shadows.mjs
export * from "./stars.mjs";
export const both = "both from shadows";

// FILE: stars.mjs
export * from "./first.mjs";
export * from "./second.mjs";
export * from "./dynamic.cjs";

// FILE: static-stars.mjs
export * from "./first.mjs";
export * from "./second.mjs";

// FILE: target.mjs
export const value = "value of target";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
