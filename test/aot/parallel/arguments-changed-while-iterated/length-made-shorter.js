function cutShort() {
  const seen = [];
  for (const value of arguments) {
    arguments.length = 2;
    seen.push(value);
  }
  return seen.join() + "|" + arguments.length;
}
console.log(cutShort("a", "b", "c", "d"));
