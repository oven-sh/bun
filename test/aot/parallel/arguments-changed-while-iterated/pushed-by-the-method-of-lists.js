function growsOnce() {
  const seen = [];
  for (const value of arguments) {
    if (seen.length === 0) Array.prototype.push.call(arguments, "d");
    seen.push(value);
  }
  return seen.join() + "|" + arguments.length;
}
console.log(growsOnce("a", "b", "c"));
