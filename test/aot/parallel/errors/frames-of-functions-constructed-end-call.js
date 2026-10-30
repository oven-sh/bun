// Prints the names, lines and columns in the stack traces of errors thrown below functions that `new` enters and that end in `return callee(..)`.
"use strict";
const frames = error =>
  error.stack
    .split("\n")
    .slice(1, 4)
    .map(line => (/at ((?:new )?[\w$<>]+) .*?(\d+:\d+)\)?$/.exec(line) || []).slice(1).join(" "))
    .join(" < ");
function attempt(label, run) {
  try {
    run();
  } catch (error) {
    console.log(label + ": " + frames(error));
  }
}
function thrower(value) {
  throw new Error("thrown " + value);
}
function forward(value) {
  return thrower(value);
}
function Stores(value) {
  this.value = value;
  return thrower(value);
}
function chooses(value) {
  return value ? thrower(value) : thrower(0);
}
function viaVariable(value) {
  const result = thrower(value);
  return result;
}
const expression = function (value) {
  return thrower(value);
};
function Base(value) {
  return thrower(value);
}
class Derived extends Base {
  constructor(value) {
    super(value);
  }
}
function first(value) {
  return thrower(value);
}
function second(value) {
  this.value = value;
  return thrower(value);
}
function outer(value) {
  return new inner(value);
}
function inner(value) {
  return thrower(value);
}
function called(value) {
  return thrower(value);
}
function twice(value) {
  return middle(value);
}
function middle(value) {
  return thrower(value);
}
attempt("only hands on", () => {
  new forward(1);
});
attempt("stores first", () => {
  new Stores(1);
});
attempt("chooses", () => {
  new chooses(1);
});
attempt("through a variable", () => {
  new viaVariable(1);
});
attempt("a function expression", () => {
  new expression(1);
});
attempt("a parent class", () => {
  new Derived(1);
});
for (const index of [0, 1])
  attempt("picked at run time", () => {
    new [first, second][index](1);
  });
attempt("constructed in tail position", () => {
  outer(1);
});
attempt("called", () => {
  called(1);
});
attempt("the callee hands on too", () => {
  new twice(1);
});
for (let round = 0; round < 3; round++)
  attempt("in a loop", () => {
    new forward(round);
  });
