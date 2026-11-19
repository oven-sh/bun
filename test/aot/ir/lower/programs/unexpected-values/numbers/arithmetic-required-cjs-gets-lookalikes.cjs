// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// Arithmetic required from a commonjs module gets lookalikes.
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

// FILE: arithmetic.cjs
var hidden = 0;

exports.add = function (a, b) {
  return a + b;
};

exports.scale = function scale(value, factor) {
  return value * factor;
};

exports.bucket = function (value) {
  return value & 15;
};

exports.next = function (value) {
  return value + 1;
};

exports.counter = 0;

exports.bump = function () {
  exports.counter++;
  return ++hidden;
};

exports.read = function () {
  return hidden;
};

exports.viaExports = function () {
  return [this.counter * 2, exports.counter & 7];
};

// FILE: impostors.cjs
module.exports = ["5", "", 1.5, -0, null, undefined, true, 5n, NaN, 2147483647, 4294967297, [5], { valueOf: () => 5 }, Symbol("s")];

// FILE: printing.cjs
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return Object.prototype.toString.call(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

module.exports = { show, attempt };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
