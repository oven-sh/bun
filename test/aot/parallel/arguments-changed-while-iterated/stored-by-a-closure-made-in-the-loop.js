function closureInside() {
  const seen = [];
  for (const value of arguments) {
    const change = () => { arguments[2] = value + "Z"; };
    change();
    seen.push(value);
  }
  return seen.join();
}
console.log(closureInside("a", "b", "c"));
