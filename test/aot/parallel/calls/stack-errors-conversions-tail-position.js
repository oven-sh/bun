// Stack traces of errors from conversions in tail position.
"use strict";
// Each function ends in a call of a built-in function that throws while it converts an operand. Every row prints which of the functions named t_.. the stack trace of the error lists.
function namesIn(stack) {
  return String(stack)
    .split("\n")
    .map(line => /(t_[a-zA-Z0-9_]+)/.exec(line))
    .filter(Boolean)
    .map(match => match[1])
    .join(" ");
}
let seen = "";
function probe(result) {
  seen = namesIn(new Error("probe").stack);
  return result;
}
function row(name, run) {
  seen = "(not run)";
  let outcome;
  try {
    outcome = typeof run();
  } catch (error) {
    outcome = error.constructor.name + " [" + namesIn(error.stack) + "]";
  }
  console.log(name + ": [" + seen + "] " + outcome);
}
const results = [];
function t_outer(run) {
  const result = run();
  results.push(result);
  return result;
}

function t_throws_number() {
  return Number(Symbol());
}
function t_throws_keys() {
  return Object.keys(null);
}
function t_throws_max() {
  return Math.max(Symbol(), 1);
}
function t_throws_concat() {
  return "a".concat(Symbol());
}

for (let turn = 0; turn < 2; turn++) {
  for (const run of [t_throws_number, t_throws_keys, t_throws_max, t_throws_concat])
    row(run.name + " " + turn, () => t_outer(run));
}
