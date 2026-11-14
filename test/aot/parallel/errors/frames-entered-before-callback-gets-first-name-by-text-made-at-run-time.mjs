// Errors are made below callbacks that are made anew for every call. Then text made at run time stores its displayName, and then the stacks are read.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = error =>
  error.stack
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];
const step = (visit, item) => visit(item);
function work(list) {
  const visit = handedBack(function visit(item) {
    kept.push(new Error(item));
  });
  const each = function each(item) {
    step(visit, item);
  };
  list.forEach(handedBack(each));
  return { visit, each };
}
const first = work(["a", "b", "c"]);
work(["d"]);
console.log(names(kept[0]));
give(first.each, "for each");
console.log(names(kept[1]));
give(first.visit, "visited");
console.log(names(kept[2]));
console.log(names(kept[3]));
