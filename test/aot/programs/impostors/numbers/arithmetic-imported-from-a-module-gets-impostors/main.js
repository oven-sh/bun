import { add, scale, bucket, next, counter, bump, setCounter } from "./arithmetic.js";
import * as everything from "./arithmetic.js";
import { show, attempt } from "./printing.js";
import { impostors } from "./impostors.js";

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + bump();
console.log("the honest total", total, counter);

for (const value of impostors) {
  const label = show(value);
  attempt("add(" + label + ", 1)", () => add(value, 1));
  attempt("scale(" + label + ", 2)", () => scale(value, 2));
  attempt("bucket(" + label + ")", () => bucket(value));
  attempt("next(" + label + ")", () => next(value));
  attempt("everything.next(" + label + ")", () => everything.next(value));
  attempt("everything['ne' + 'xt'](" + label + ")", () => everything["ne" + "xt"](value));
  attempt("the exported counter becomes " + label, () => {
    setCounter(value);
    return [counter, everything.counter, counter + 1, counter | 0];
  });
  attempt("and is bumped", () => [bump(), counter, everything.counter]);
}

setCounter(2147483646);
attempt("the exported counter passes the largest int32", () => [bump(), bump(), bump(), counter, counter | 0]);
attempt("honest calls afterwards", () => [add(1, 2), scale(3, 4), bucket(300), next(41)]);
