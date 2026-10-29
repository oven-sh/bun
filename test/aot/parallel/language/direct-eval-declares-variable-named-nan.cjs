// A direct eval in a sloppy function declares `var NaN`: behind it the name is the variable of the function, not the constant of the language. `undefined` and `Infinity` stay what they were:
// plain Bun puts their values in the place of the names when it reads the file, also here, and a compiled program does as plain Bun does.
function declaresNaN() {
  eval("var NaN = 1");
  return NaN;
}
function declaresUndefined() {
  eval("var undefined = 2");
  return undefined;
}
function declaresInfinity() {
  eval("var Infinity = 3");
  return Infinity;
}
console.log(declaresNaN(), declaresUndefined(), declaresInfinity());
