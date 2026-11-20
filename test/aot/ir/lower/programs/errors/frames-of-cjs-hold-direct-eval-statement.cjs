// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8
// CHECK-LABEL: function {{*}}name="show"

// FILE: main.cjs
// Each of these CommonJS files holds a direct eval or a `with` statement, so its text looks names up while it runs. Each prints every frame of the stacks that it reads, whole, under four limits and below a function.
globalThis.framesOf = function framesOf(stack) {
  return String(stack)
    .split("\n")
    .filter(line => /^\s*at /.test(line))
    .map(line =>
      line
        .trim()
        .slice(3)
        .replace(/[^ ()]*[\\/]([\w.-]+:\d+:\d+)/, "$1")
        .replace(/native:\d+:\d+/, "native"),
    )
    .join(" < ");
};
globalThis.show = function show(label) {
  console.log(label, "|", framesOf(new Error().stack));
  for (const limit of [1, 2, 3, 4]) {
    Error.stackTraceLimit = limit;
    console.log(label, limit, "|", framesOf(new Error().stack));
  }
  Error.stackTraceLimit = 10;
  const target = {};
  Error.captureStackTrace(target, show);
  console.log(label, "below show |", framesOf(target.stack));
};
show("the entry point");
require("./runs-a-direct-eval.cjs");
require("./runs-a-direct-eval-in-strict-code.cjs");
require("./holds-a-direct-eval-in-an-arrow-function.cjs");
require("./holds-a-direct-eval-that-never-runs.cjs");
require("./reads-a-stack-in-the-text.cjs");
require("./holds-a-with-statement.cjs");
require("./does-none-of-these.cjs");

// FILE: does-none-of-these.cjs
show("does none of these, at the top");
function inner() {
  show("does none of these, in a function");
}
inner();
[0].forEach(() => show("does none of these, in a callback"));
exports.done = true;

// FILE: holds-a-direct-eval-in-an-arrow-function.cjs
show("holds a direct eval in an arrow function, at the top");
function inner() {
  show("holds a direct eval in an arrow function, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval in an arrow function, in a callback"));
exports.later = () => eval("2");

// FILE: holds-a-direct-eval-that-never-runs.cjs
show("holds a direct eval that never runs, at the top");
function inner() {
  show("holds a direct eval that never runs, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval that never runs, in a callback"));
function never() {
  return eval("3");
}
exports.done = true;

// FILE: holds-a-with-statement.cjs
show("holds a with statement, at the top");
function inner() {
  show("holds a with statement, in a function");
}
inner();
[0].forEach(() => show("holds a with statement, in a callback"));
with ({ inside: 1 }) {
  exports.inside = inside;
}

// FILE: reads-a-stack-in-the-text.cjs
show("reads a stack in the text, at the top");
function inner() {
  show("reads a stack in the text, in a function");
}
inner();
[0].forEach(() => show("reads a stack in the text, in a callback"));
eval('show("in the text")');
exports.done = true;

// FILE: runs-a-direct-eval-in-strict-code.cjs
"use strict";
show("runs a direct eval in strict code, at the top");
function inner() {
  show("runs a direct eval in strict code, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval in strict code, in a callback"));
exports.answer = eval("1 + 1");

// FILE: runs-a-direct-eval.cjs
show("runs a direct eval, at the top");
function inner() {
  show("runs a direct eval, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval, in a callback"));
exports.answer = eval("1 + 1");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
