// `__esModule` is an accessor on the prototype of Bun's namespace objects, and `require()` of an ES module sets it: a read of this name on an imported namespace is not the `undefined` of an absent export.
import * as ns from "./a.mjs";
import * as neverRequired from "./never-required.mjs";
import * as marksItself from "./marks-itself.mjs";

console.log("before:", ns.__esModule, ns["__esModule"], "__esModule" in ns);
console.log("required:", require("./a.mjs") === ns);
console.log("after:", ns.__esModule, ns["__esModule"], "__esModule" in ns, Object.keys(ns).join());
console.log("never required:", neverRequired.__esModule, neverRequired.absent);
console.log("own export:", marksItself.__esModule, require("./marks-itself.mjs").__esModule, marksItself.__esModule);
