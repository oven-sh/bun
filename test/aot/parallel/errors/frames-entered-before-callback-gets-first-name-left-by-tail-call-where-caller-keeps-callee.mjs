// A callback that left sight is called by the function that made it, and ends with a call of a function object that nobody follows. The stack is taken before either gets a name.
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
function make() {
  return handedBack(function link(value) {
    kept.push(new Error(value));
    return value;
  });
}
function work(next, item) {
  const hop = function hop(value) {
    return next(value);
  };
  handedBack(hop);
  const result = hop(item);
  return [hop, result];
}
function main() {
  const one = make();
  const two = make();
  const [hop] = work(one, "a");
  work(two, "b");
  work(one, "c");
  give(one, "one");
  give(hop, "hop one");
  console.log(names(kept[0]));
  console.log(names(kept[1]));
  give(two, "two");
  console.log(names(kept[2]));
  work(two, "d");
  console.log(names(kept[3]));
}
main();
