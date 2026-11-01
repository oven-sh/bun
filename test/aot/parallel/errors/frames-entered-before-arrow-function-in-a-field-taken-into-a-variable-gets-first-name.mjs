// As frames-entered-before-arrow-function-in-a-field-gets-first-name.mjs, and the function is taken into a variable and called by value.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, ""),
    )
    .join(" < ");
const kept = [];
class Holder {
  constructor(label) {
    this.label = label;
  }
  handle = value => {
    kept.push(new Error(this.label + value));
  };
}
const holders = [new Holder("a"), new Holder("b")];
for (const holder of holders) holder.handle(1);
const taken = holders[1].handle;
const left = handedBack(taken);
taken(2);
give(left, "left");
console.log(kept.map(error => names(error, 1)).join(" . "));
