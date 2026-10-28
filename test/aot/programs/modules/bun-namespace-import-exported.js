// `import * as ns from "bun"; export { ns }` exports the global `Bun` object, to importers and in the namespace object of the exporter. `export * as ns from "bun"` exports a module namespace object.
import * as held from "bun";
export { held };
export * as namespace from "bun";
import * as self from "./bun-namespace-import-exported.js";
import { held as importedHeld, namespace as importedNamespace } from "./bun-namespace-import-exported.js";

const read = (object, name) => object[name];
const tag = value => Object.prototype.toString.call(value);

console.log("held:", held === Bun, importedHeld === Bun, self.held === Bun, read(self, "held") === Bun);
console.log("namespace:", importedNamespace === Bun, self.namespace === Bun, read(self, "namespace") === Bun);
console.log("namespace:", tag(importedNamespace), importedNamespace === self.namespace, importedNamespace === read(self, "namespace"), importedNamespace.default === Bun);
console.log(Object.keys(self).join(" "));
