function storesAhead() {
  const seen = [];
  for (const value of arguments) {
    if (value === "a") arguments[1] = "Y";
    seen.push(value);
  }
  return seen.join();
}
console.log(storesAhead("a", "b", "c"));
console.log(storesAhead("b", "a", "c"));
console.log(storesAhead("a"));
