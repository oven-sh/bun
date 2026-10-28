// The main module and the parent of a file that an es module imports.
import a from "./a.cjs";
console.log(a.r.join(), typeof import.meta.main, import.meta.main);
