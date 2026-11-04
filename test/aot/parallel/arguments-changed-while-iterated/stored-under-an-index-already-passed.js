function storesBehind() {
  const seen = [];
  let at = 0;
  for (const value of arguments) {
    arguments[at++] = value + "!";
    seen.push(value);
  }
  return seen.join() + "|" + arguments[0] + arguments[1] + arguments[2];
}
console.log(storesBehind("a", "b", "c"));
