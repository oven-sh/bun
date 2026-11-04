function madeLonger() {
  const seen = [];
  for (const value of arguments) {
    arguments.length = 5;
    seen.push(String(value));
  }
  return seen.join() + "|" + arguments.length;
}
console.log(madeLonger("a", "b", "c"));
