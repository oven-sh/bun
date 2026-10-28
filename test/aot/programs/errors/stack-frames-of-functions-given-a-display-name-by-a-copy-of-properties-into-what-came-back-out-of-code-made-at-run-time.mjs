// Prints what the first stack frame calls each of two function objects of one function once Object.assign has copied a displayName into one of them, which came back out of code made at run time.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function make() {
  return function made() {
    return new Error("x").stack;
  };
}
const given = make();
const other = make();
const before = firstFrame(given());
Object.assign(handedBack(given), { displayName: "displayed" });
console.log(
  before,
  "|",
  firstFrame(given()),
  "|",
  firstFrame(other()),
  "|",
  firstFrame(handedBack(given)()),
  "|",
  firstFrame(handedBack(other)()),
);
