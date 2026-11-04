function definesOne() {
  const seen = [];
  for (const value of arguments) {
    Object.defineProperty(arguments, 2, { get() { return "G"; }, configurable: true });
    seen.push(value);
  }
  return seen.join();
}
console.log(definesOne("a", "b", "c"));
