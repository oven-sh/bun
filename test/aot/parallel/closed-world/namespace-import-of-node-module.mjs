// Making the namespace object of node:module reads every export, `_cache` among them, and Bun's own JavaScript makes that object. The program never names the cache, and the import works all the same.
import * as namespace from "node:module";
console.log(namespace.isBuiltin("node:os"), namespace.isBuiltin("./file.js"), typeof namespace.createRequire);
