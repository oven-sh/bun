function storesParameter(first, second) {
  var seen = [];
  for (var value of arguments) {
    second = "Z";
    seen.push(value);
  }
  return seen.join();
}
function storesElement(first, second) {
  var seen = [];
  for (var value of arguments) {
    arguments[1] = "Y";
    seen.push(value + second);
  }
  return seen.join();
}
console.log(storesParameter("a", "b", "c"));
console.log(storesElement("a", "b", "c"));
