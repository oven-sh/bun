// An ES module imports the names, the namespace and the default of a CommonJS file as a bundler writes it, which stores its names again.
import { count, label, inc, late, fill } from "./lib.cjs";
import * as ns from "./lib.cjs";
import whole from "./lib.cjs";
console.log(count, label, typeof late, ns.count, whole.count);
inc(); inc();
console.log(count, label, ns.count, ns.label, whole.count, whole.label);
fill();
console.log(typeof late, typeof ns.late, typeof whole.late, Object.keys(ns).join(), Object.keys(whole).join());
