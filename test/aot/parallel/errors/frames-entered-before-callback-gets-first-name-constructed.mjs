// A function that is made anew for every call leaves sight and is constructed. The stack is taken before it gets its first name.
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
  return handedBack(function Made(value) {
    this.value = value;
    kept.push(new Error(value));
  });
}
function main() {
  const One = make();
  const Two = make();
  new One("a");
  new Two("b");
  new Two("c");
  give(One, "One");
  console.log(names(kept[0], 2));
  console.log(names(kept[1], 2));
  Reflect.construct(Two, ["d"]);
  give(Two, "Two");
  console.log(names(kept[2], 2));
  console.log(names(kept[3], 2));
}
main();
