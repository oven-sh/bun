// `export * from` a CommonJS module: the namespace lists what the module has stored by the time the namespace is made, not every name that its text stores to: a name that is stored to later, or on a path that is not taken, is no key.
import * as ns from "./star.js";
import { stored, changed, own } from "./star.js";
console.log(Object.keys(ns).sort().join(), stored, changed, own, "later" in ns, "notTaken" in ns, ns.later, ns.notTaken, "default" in ns);
setTimeout(() => console.log(Object.keys(ns).sort().join(), changed, ns.changed, ns.later, "later" in ns), 5);
