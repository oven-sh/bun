import { results, attempt } from "./results.mjs";
import { fromB } from "./b.mjs";
export function readValue() {
  return value;
}
// Its own module calls it once, behind the declaration. The other module calls it earlier.
export function readOnce() {
  return value;
}
export function bump() {
  counter++;
}
attempt("a, early", readValue);
export const value = { name: "value of a" };
export let counter = 10;
results.push(["a, in the body", value.name, readOnce().name, counter, fromB]);
bump();
results.push(["a, in the body", counter]);
