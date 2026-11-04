function evaluates() {
  const seen = [];
  for (const value of arguments) {
    eval("arguments[2] = 'Z'");
    seen.push(value);
  }
  return seen.join();
}
console.log(evaluates("a", "b", "c"));
