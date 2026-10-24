// Three export stars name the same things.
import * as ns from "./all.mjs";
console.log(Object.keys(ns).join(), ns.a, ns.b, ns.c, ns.default);
