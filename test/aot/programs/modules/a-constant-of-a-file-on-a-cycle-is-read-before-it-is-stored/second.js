import { results } from "./results.js";
import { first } from "./first.js";
import * as all from "./first.js";
export const second = 2;
export function readFirst() {
  return first ? "yes" : "no";
}
function attempt(name, read) {
  try {
    results.push([name, read()]);
  } catch (error) {
    results.push([name, error.constructor.name]);
  }
}
attempt("a branch", () => (first ? "yes" : "no"));
attempt("an if", () => {
  if (first) return "taken";
  return "not taken";
});
attempt("typeof", () => typeof first);
attempt("a namespace", () => (all.first ? "yes" : "no"));
attempt("a name that is not there", () => typeof all.absent);
attempt("and", () => first && "never");
attempt("a function", readFirst);
