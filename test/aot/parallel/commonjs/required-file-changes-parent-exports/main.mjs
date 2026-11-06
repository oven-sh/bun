// The entry point is an ES module. lib.cjs, which it imports, requires child.cjs, and child.cjs stores into and calls what lib.cjs exports through `module.parent`: lib.cjs sees both.
import lib from "./lib.cjs";
console.log(lib.report());
