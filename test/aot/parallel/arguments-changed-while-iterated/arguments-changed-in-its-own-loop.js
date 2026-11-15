function changedInTheLoop() {
  const seen = [];
  for (const value of arguments) {
    arguments[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
function cutShortInTheLoop() {
  const seen = [];
  for (const value of arguments) {
    arguments.length = 1;
    seen.push(value);
  }
  return seen.join();
}
console.log(changedInTheLoop("a", "b", "c"));
console.log(cutShortInTheLoop("a", "b", "c"));
