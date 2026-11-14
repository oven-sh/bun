// RUN: lower
// OPTIONS: builtin-modules

// Array.prototype.flat constructs the species of its receiver. That is the only place where the program reaches the Function constructor, which compiles the text of what it is given.
try {
  const list = [1, [2]]; list.constructor = { [Symbol.species]: Function }; console.log(typeof list.flat());
} catch (error) {
  console.log(error.name, error.message);
}
