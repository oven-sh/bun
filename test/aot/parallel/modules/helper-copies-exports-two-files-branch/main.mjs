// A helper copies the exports of two files one of them in a branch.
import * as ns from "./index.cjs";
import d from "./index.cjs";
console.log(Object.keys(ns).sort().join(), ns.a, ns.b, ns.own, typeof d);
