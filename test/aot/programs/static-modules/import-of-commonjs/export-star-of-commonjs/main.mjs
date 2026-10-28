// `export *` of a CommonJS file: its names without `default`, as copies.
import * as ns from "./s.mjs";
ns.set();
console.log(Object.keys(ns).join(), ns.x);
