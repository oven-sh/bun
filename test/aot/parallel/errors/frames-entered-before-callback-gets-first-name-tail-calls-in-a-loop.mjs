// Function objects of one function that left sight call each other in tail position, in a loop that runs often. The stacks are taken before any gets a name.
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
function make(next) {
  const link = function link(value) {
    if (next)
      return next(value);
    if (value % 1000 === 0)
      kept.push(new Error(String(value)));
    return value;
  };
  handedBack(link);
  return link;
}
function main() {
  const last = make(null);
  const middle = make(last);
  const first = make(middle);
  let sum = 0;
  for (let index = 0; index < 3000; ++index)
    sum += first(index);
  console.log(sum, kept.length);
  give(first, "first");
  console.log(names(kept[0], 2));
  give(last, "last");
  console.log(names(kept[1], 2));
  give(middle, "middle");
  console.log(names(kept[2], 2));
  for (let index = 0; index < 1001; ++index)
    sum += first(index);
  console.log(names(kept[3], 2));
}
main();
