// This at the top of each kind of file.
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
/* Output:
this file is strict: true
a sloppy CommonJS file Object{top: "object", isTheExportsObject: true, inAnArrow: "object"}
a strict CommonJS file Object{top: "object", isTheExportsObject: true, inAnArrow: "object"}
an ES module Object{inAnArrow: "undefined", top: "undefined"}
the main ES module "undefined"
*/
