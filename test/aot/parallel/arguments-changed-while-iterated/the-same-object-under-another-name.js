function same(value) { return value; }
function throughIdentity() {
  const seen = [];
  for (const value of same(arguments)) {
    arguments[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
function walks(list, other) {
  const seen = [];
  for (const value of list) {
    other[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
function handsTwice() { return walks(arguments, arguments); }
function secondName() {
  const seen = [];
  const other = arguments;
  for (const value of arguments) {
    other[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
console.log(throughIdentity("a", "b", "c"));
console.log(handsTwice("a", "b", "c"));
console.log(secondName("a", "b", "c"));
