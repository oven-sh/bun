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
