function loopsTwice() {
  const seen = [];
  for (let round = 0; round < 2; round++) {
    for (const value of arguments) seen.push(value);
    arguments[0] = "Z";
    arguments.length = 2;
  }
  return seen.join();
}
console.log(loopsTwice("a", "b", "c"));
