function copiesBehindStore() {
  arguments[1] = "Y";
  return [...arguments].join() + "|" + Array.from(arguments).join() + "|" + Array.prototype.slice.call(arguments).join();
}
function copiesBehindLength() {
  arguments.length = 2;
  return [...arguments].join() + "|" + Array.from(arguments).join() + "|" + Array.prototype.slice.call(arguments).join();
}
function copiesInTheLoop() {
  const seen = [];
  for (const value of arguments) {
    arguments[2] = value + "Z";
    seen.push([...arguments].join(""), Array.from(arguments).join(""));
  }
  return seen.join();
}
console.log(copiesBehindStore("a", "b", "c"));
console.log(copiesBehindLength("a", "b", "c"));
console.log(copiesInTheLoop("a", "b", "c"));
