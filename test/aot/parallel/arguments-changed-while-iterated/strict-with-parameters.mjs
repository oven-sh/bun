function storesParameter(first, second) {
  const seen = [];
  for (const value of arguments) {
    second = "Z";
    seen.push(value);
  }
  return seen.join() + "|" + second;
}
function storesElement(first, second) {
  const seen = [];
  for (const value of arguments) {
    arguments[1] = "Y";
    arguments[2] = "Z";
    seen.push(value + second);
  }
  return seen.join();
}
console.log(storesParameter("a", "b", "c"));
console.log(storesElement("a", "b", "c"));
