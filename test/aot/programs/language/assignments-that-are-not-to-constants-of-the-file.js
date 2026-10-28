// Assignments that a build accepts: to names that are no `const` of the file's own text, or written in text made at run time.
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  console.log(name + ": " + String(answer));
};
const constant = 1;
say("a name of the same spelling in a block", () => {
  let constant = 2;
  constant = 3;
  return constant;
});
say("a parameter of the same spelling", () => (constant => (constant = 4))(0));
say("a catch parameter", () => {
  try {
    throw 1;
  } catch (error) {
    error = 5;
    return error;
  }
});
say("the name of a class, outside", () => {
  class Named {}
  Named = 6;
  return Named;
});
say("the name of a class, inside", () => {
  class Named {
    static change() {
      Named = 7;
    }
  }
  Named.change();
  return typeof Named;
});
say("the name of a function expression", () =>
  (function named() {
    named = 8;
    return typeof named;
  })(),
);
say("the name of a strict function expression", () =>
  (function named() {
    "use strict";
    named = 9;
    return typeof named;
  })(),
);
say("evaluated text names the constant", () => eval("constant = 10"));
say("evaluated text holds the constant", () => eval("const inner = 1; inner = 11;"));
say("a function made from text", () => new Function("const inner = 1; inner = 12;")());
say("evaluated text increments the constant", () => eval("constant++"));
say("the constant is as it was", () => constant);
