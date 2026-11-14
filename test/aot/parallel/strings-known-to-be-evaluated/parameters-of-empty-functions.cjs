// A function with nothing in its body stores in the defaults of its parameters, when it is called.
"use strict";
function declared(run) {
  let op = "+";
  function g(_ = (op = "*")) {}
  op = "-";
  run(() => g());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
function nested(run) {
  let op = "+";
  function g([_ = (op = "*")] = []) {}
  op = "-";
  run(() => g());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
function arrow(run) {
  let op = "+";
  const g = (_ = (op = "*")) => {};
  op = "-";
  run(() => g());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
function method(run) {
  let op = "+";
  const o = { g({ _ = (op = "*") } = {}) {} };
  op = "-";
  run(() => o.g());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
function constructed(run) {
  let op = "+";
  class C { constructor(a, b = (op = "*")) {} }
  op = "-";
  run(() => new C());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
function last(run) {
  let op = "+";
  const g = function (a, b = (op = "*"), c) {};
  op = "-";
  run(() => g());
  return eval("(function made(a, b) { return a " + op + " b; })")(6, 7);
}
for (const run of [() => {}, f => f()]) {
  console.log(declared(run), nested(run), arrow(run), method(run), constructed(run), last(run));
}
