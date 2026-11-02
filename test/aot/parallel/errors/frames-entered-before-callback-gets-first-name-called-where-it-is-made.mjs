// A callback is made anew for every call, leaves sight and is then called by the function that made it. The stack is taken before it gets its first name.
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

function work(item) {
  const each = function each(value) {
    kept.push(new Error(value));
  };
  handedBack(each);
  each(item);
  return each;
}
function main() {
  const first = work("a");
  const second = work("b");
  work("c");
  give(first, "first");
  console.log(names(kept[0]));
  console.log(names(kept[1]));
  give(second, "second");
  console.log(names(kept[2]));
  work("d");
  console.log(names(kept[3]));
}
main();
