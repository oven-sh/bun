function replacesMethod() {
  const seen = [];
  for (const value of arguments) {
    arguments[Symbol.iterator] = function* () { yield "mine"; };
    seen.push(value);
  }
  for (const value of arguments) seen.push(value);
  return seen.join();
}
console.log(replacesMethod("a", "b", "c"));
