const arithmetic = require("./arithmetic.cjs");
const { add, scale, bucket, next } = require("./arithmetic.cjs");
const { show, attempt } = require("./printing.cjs");
const impostors = require("./" + ["impostors", "cjs"].join("."));

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + arithmetic.bump() + arithmetic.add(i, 1);
console.log("the honest total", total, arithmetic.counter, arithmetic.read());

for (const value of impostors) {
  const label = show(value);
  attempt("add(" + label + ", 1)", () => add(value, 1));
  attempt("scale(" + label + ", 2)", () => scale(value, 2));
  attempt("bucket(" + label + ")", () => bucket(value));
  attempt("next(" + label + ")", () => next(value));
  attempt("arithmetic.next(" + label + ")", () => arithmetic.next(value));
  attempt("arithmetic['ne' + 'xt'](" + label + ")", () => arithmetic["ne" + "xt"](value));
  attempt("exports.counter becomes " + label, () => {
    arithmetic.counter = value;
    return [arithmetic.counter, arithmetic.counter + 1, arithmetic.counter | 0, arithmetic.viaExports()];
  });
  attempt("and is incremented", () => [arithmetic.counter++, arithmetic.counter]);
}

arithmetic.next = value => value + "!";
attempt("a replaced export", () => [arithmetic.next(1), next(1), require("./arithmetic.cjs").next(1)]);
attempt("honest calls afterwards", () => [add(1, 2), scale(3, 4), bucket(300), next(41)]);
