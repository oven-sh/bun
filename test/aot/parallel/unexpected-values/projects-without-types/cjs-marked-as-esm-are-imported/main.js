import point, { origin } from "./lib/point.cjs";
import unmarked, { origin as unmarkedOrigin } from "./lib/unmarked.cjs";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function sumOf(made) {
  return made.sum();
}
attempt("typeof the default of a marked file", () => typeof point);
attempt("typeof the default of an unmarked file", () => typeof unmarked);
attempt("origin of a marked file", () => sumOf(origin()));
attempt("origin of an unmarked file", () => sumOf(unmarkedOrigin()));
attempt("new of the default of a marked file", () => sumOf(new point(1, 2)));
attempt("new of its member default", () => sumOf(new point.default(1, 2)));
attempt("call of the default of an unmarked file", () => sumOf(unmarked(1, 2)));
attempt("call of its member default", () => sumOf(unmarked.default(1, 2)));
