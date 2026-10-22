import * as module from "./module.mjs";
import shown from "./show.cjs";
import sloppy from "./sloppy.cjs";
import strict from "./strict.cjs";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const { attempt } = shown;
attempt("a sloppy CommonJS file", () => sloppy);
attempt("a strict CommonJS file", () => strict);
attempt("an ES module", () => ({ ...module }));
attempt("the main ES module", () => (this === undefined ? "undefined" : this === null ? "null" : typeof this));
