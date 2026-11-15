// RUN: lower
// OPTIONS: builtin-modules

// A subclass of function kept in a global makes a function.
Maker = class extends Function {};
const addOne = new Maker("x", "return x + 1");
console.log(addOne(1));

// CHECK-LABEL: function {{*}}name="Maker"
