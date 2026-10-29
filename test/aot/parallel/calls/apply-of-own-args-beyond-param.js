// `f.apply(this, arguments)` with more arguments than parameters makes the object and a list from it. The list has what the object has at the call:
// after a changed length, a longer length, holes, deleted and redefined elements, getters, elements far away, a length that is no number, and an inherited element.
"use strict";
function show() {
  const parts = [arguments.length];
  for (let i = 0; i < arguments.length; i++) parts.push(i in arguments ? String(arguments[i]) : "hole");
  return parts.join(" ");
}

function asPassed(first) {
  return show.apply(this, arguments);
}
function shorter(first) {
  arguments.length = 1;
  return show.apply(this, arguments);
}
function longer(first) {
  arguments.length = 5;
  return show.apply(this, arguments);
}
function empty(first) {
  arguments.length = 0;
  return show.apply(this, arguments);
}
function lengthIsText(first) {
  arguments.length = "2";
  return show.apply(this, arguments);
}
function lengthIsFraction(first) {
  arguments.length = 2.9;
  return show.apply(this, arguments);
}
function lengthIsNegative(first) {
  arguments.length = -1;
  return show.apply(this, arguments);
}
function lengthIsObject(first) {
  let asked = 0;
  arguments.length = { valueOf() { asked++; return 2; } };
  return show.apply(this, arguments) + " asked " + asked;
}
function lengthIsDeleted(first) {
  delete arguments.length;
  return show.apply(this, arguments);
}
function lengthIsGetter(first) {
  Object.defineProperty(arguments, "length", { get() { return 2; } });
  return show.apply(this, arguments);
}
function elementChanged(first) {
  arguments[1] = "changed";
  return show.apply(this, arguments);
}
function elementDeleted(first) {
  delete arguments[1];
  return show.apply(this, arguments);
}
function elementIsGetter(first) {
  let asked = 0;
  Object.defineProperty(arguments, 1, { get() { return "got " + ++asked; } });
  return show.apply(this, arguments);
}
function elementAdded(first) {
  arguments[arguments.length] = "added";
  arguments.length++;
  return show.apply(this, arguments);
}
function elementFarAway(first) {
  arguments[100000] = "far";
  return show.apply(this, arguments);
}
function otherProperty(first) {
  arguments.extra = 1;
  return show.apply(this, arguments);
}
function otherPrototype(first) {
  delete arguments[0];
  Object.setPrototypeOf(arguments, { 0: "inherited" });
  return show.apply(this, arguments);
}
function frozen(first) {
  Object.freeze(arguments);
  return show.apply(this, arguments);
}
function listIsNew(first) {
  const seen = [];
  function keep() {
    seen.push(arguments);
    arguments[0] = "written by the callee";
    return arguments.length;
  }
  keep.apply(this, arguments);
  keep.apply(this, arguments);
  return [seen[0] === seen[1], seen[0] === arguments, arguments[0], seen[0][0]].join(" ");
}
function manyArguments(first) {
  return show.apply(this, arguments).length;
}

const functions = [
  asPassed, shorter, longer, empty, lengthIsText, lengthIsFraction, lengthIsNegative, lengthIsObject, lengthIsDeleted, lengthIsGetter,
  elementChanged, elementDeleted, elementIsGetter, elementAdded, elementFarAway, otherProperty, otherPrototype, frozen, listIsNew,
];
const lines = [];
for (const f of functions) {
  let last;
  for (let round = 0; round < 40; round++) last = [f(), f(1), f(1, "two"), f(1.5, undefined, null), f({ toString() { return "object"; } }, 2, 3, 4)].join(" | ");
  lines.push(f.name + ": " + last);
}
const many = Array.from({ length: 200 }, (_, index) => index);
lines.push("manyArguments: " + [manyArguments(...many.slice(0, 63)), manyArguments(...many.slice(0, 64)), manyArguments(...many.slice(0, 65)), manyArguments(...many)].join(" "));
console.log(lines.join("\n"));
