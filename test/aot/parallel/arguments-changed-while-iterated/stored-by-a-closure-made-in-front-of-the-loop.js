function closureInFront() {
  const seen = [];
  const change = () => { arguments[2] = "Z"; };
  for (const value of arguments) {
    change();
    seen.push(value);
  }
  return seen.join();
}
console.log(closureInFront("a", "b", "c"));
