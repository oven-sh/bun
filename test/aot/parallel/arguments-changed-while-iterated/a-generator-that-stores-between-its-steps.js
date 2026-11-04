function* yieldsEach() {
  for (const value of arguments) {
    arguments[2] = "Z";
    yield value;
  }
}
console.log([...yieldsEach("a", "b", "c")].join());
