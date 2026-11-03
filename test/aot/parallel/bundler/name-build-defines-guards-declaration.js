// What a name that the build defines guards runs, also between the declaration of a variable and the `return` that gives it back.
// Flags: --define process.env.NODE_ENV="production"
// Reference: bun build --compile
let n = 0;
function make() {
  return "made";
}
function f() {
  const t = make();
  if (process.env.NODE_ENV === "production") {
    n++;
  }
  return t;
}
console.log(f(), n);

function guardedByWhatDoesNotHold() {
  const t = make();
  if (process.env.NODE_ENV !== "production") {
    n++;
  }
  return t;
}
console.log(guardedByWhatDoesNotHold(), n);
