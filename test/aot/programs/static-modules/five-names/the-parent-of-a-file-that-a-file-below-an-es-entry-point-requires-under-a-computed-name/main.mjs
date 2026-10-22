// The entry point is an ES module. lib.cjs, which it imports, requires child.cjs under a name that the compiler cannot follow, and child.cjs changes what lib.cjs exports through `module.parent`.
import lib from "./lib.cjs";
console.log(lib.report());
