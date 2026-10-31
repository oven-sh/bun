// A default is put on the default of the namespace of node module.
import * as ns from "node:module"; ns.default.default = { createRequire: () => name => console.log("mine", name) }; ns.default.default.createRequire(import.meta.url)("./next.mjs");
