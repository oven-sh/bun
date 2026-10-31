// A callback that left sight ends with a call of another function object of the same function, or of another function.
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
  return handedBack(function link(value) {
    if (!next) {
      kept.push(new Error(value));
      return value;
    }
    return next(value);
  });
}
function other(next) {
  return handedBack(function hop(value) {
    return next(value);
  });
}
const last = make(null);
const middle = make(last);
const outer = other(middle);
const start = value => { const result = outer(value); return result + "!"; };
console.log(start("a"));
give(last, "last");
give(middle, "middle");
give(outer, "outer");
console.log(names(kept[0], 2));
console.log(start("b"));
console.log(names(kept[1], 2));
