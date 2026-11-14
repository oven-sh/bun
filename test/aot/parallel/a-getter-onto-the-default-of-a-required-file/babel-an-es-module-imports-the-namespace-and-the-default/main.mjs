import * as ns from "./barrel.cjs";
import whole from "./barrel.cjs";
console.log(Object.keys(ns).join(), typeof whole, ns.add(1, 2), typeof ns.default, whole && typeof whole.add);
