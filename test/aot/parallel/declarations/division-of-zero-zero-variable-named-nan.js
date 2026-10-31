// Divides zero by zero in functions that have a variable or a parameter named NaN: the quotient is the number, whatever the name holds. Plain Bun prints another output.
function variable() {
  var NaN = "a variable of the program";
  return [0 / 0, typeof (0 / 0), Object.is(NaN, 0 / 0)];
}
function parameter(NaN) {
  return [0 / 0, typeof (0 / 0)];
}
function constant() {
  const Infinity = "a variable of the program";
  return [1 / 0, -1 / 0, typeof (1 / 0)];
}
function nothing(undefined) {
  return [void 0, typeof void 0, (() => {})()];
}
console.log(variable().join(" | "));
console.log(parameter("a parameter of the program").join(" | "));
console.log(constant().join(" | "));
console.log(nothing("a parameter of the program").join(" | "));
/* Output:
NaN | number | false
NaN | number
Infinity | -Infinity | number
 | undefined | 
*/
