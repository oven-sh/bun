// commonjs/a-required-file-changes-what-its-parent-exports, where lib.cjs requires child.cjs under a name that the compiler cannot follow.
import lib from "./lib.cjs";
console.log(lib.report());
