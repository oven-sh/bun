// Of one function, one function object never leaves the caller and another does. Both are called by value from the same place.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];

const run = (callback, value) => callback(value);
function work(item, leaves) {
  const each = function each(value) {
    kept.push(new Error(value));
  };
  if (leaves)
    handedBack(each);
  for (const callback of [each])
    run(callback, item);
  return leaves ? each : null;
}
function both() {
  const left = work("a", true);
  work("b", false);
  return left;
}
const left = both();
give(left, "left");
console.log(names(kept[0]));
console.log(names(kept[1]));
[1, 2].forEach(function twice(n) {
  const made = work("c" + n, n === 1);
  if (made)
    give(made, "made " + n);
});
console.log(names(kept[2]));
console.log(names(kept[3]));
