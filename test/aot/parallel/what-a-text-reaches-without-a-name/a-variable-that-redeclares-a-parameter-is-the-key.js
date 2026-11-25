// A `var` that redeclares a parameter of a function with parameter expressions is born with the value of the parameter.
function pick(list, key = "flatMap") {
  var key;
  return list[key];
}
console.log(pick([1, 2]).call([1, 2], n => [n, n]));
