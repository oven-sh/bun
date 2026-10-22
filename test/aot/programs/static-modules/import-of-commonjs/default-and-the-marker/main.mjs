// A CommonJS file with `__esModule` and an own `default`: the default import is that `default`.
import d, * as ns from "./a.cjs";
console.log(typeof d, Object.keys(ns).join(), ns.__esModule);
