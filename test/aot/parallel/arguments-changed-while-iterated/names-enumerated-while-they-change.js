function enumerates() {
  const seen = [];
  for (const name in arguments) {
    delete arguments[1];
    arguments[2] = "Z";
    seen.push(name + "=" + arguments[name]);
  }
  return seen.join();
}
console.log(enumerates("a", "b", "c"));
