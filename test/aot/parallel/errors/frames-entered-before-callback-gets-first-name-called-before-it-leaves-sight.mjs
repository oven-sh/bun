// A callback is called by the function that made it and leaves sight only behind that call.
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
  each(item);
  return handedBack(each);
}
function main() {
  const first = work("a");
  const second = work("b");
  give(first, "first");
  console.log(names(kept[0]));
  console.log(names(kept[1]));
  for (let index = 0; index < 100; ++index)
    work("c" + index);
  const last = work("z");
  give(last, "last");
  console.log(names(kept.at(-1)));
  console.log(names(kept.at(-2)));
}
main();
