function sloppyStores() {
  var seen = [];
  for (var value of arguments) {
    arguments[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
function sloppyCuts() {
  var seen = [];
  for (var value of arguments) {
    arguments.length = 1;
    seen.push(value);
  }
  return seen.join();
}
console.log(sloppyStores("a", "b", "c"));
console.log(sloppyCuts("a", "b", "c"));
