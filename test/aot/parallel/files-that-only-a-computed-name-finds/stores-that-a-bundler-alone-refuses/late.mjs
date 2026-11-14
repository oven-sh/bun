import * as all from "./counter.mjs";
import { count, bump } from "./counter.mjs";
function neverCalled() {
  count = 100;
}
export const seen = [];
function attempt(what, store) {
  try {
    store();
    seen.push(what + ": no throw");
  } catch (e) {
    seen.push(what + ": " + e.name + ": " + e.message);
  }
}
attempt("a store", () => { count = 5; });
attempt("an increment", () => { count++; });
attempt("a pattern", () => { [count] = [9]; });
attempt("a loop", () => { for (count of [1]); });
attempt("a loop over nothing", () => { for (count of []); });
attempt("the namespace object", () => { all = 1; });
attempt("a member of it", () => { all.count = 7; });
attempt("the removal of a member", () => { delete all.count; });
seen.push([count, bump(), count, all.count, typeof neverCalled].join(" "));
