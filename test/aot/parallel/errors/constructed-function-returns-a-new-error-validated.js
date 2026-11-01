// `return new Error()` stands where a tail call would. A function that was constructed makes none, and its frame is named by the function object.
// Flags: --aot-validate
const top = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "("))
    .join(" | ");

function make() {
  return new Error("m");
}
function call(callback) {
  return new callback("", 1.5, true);
}
for (let turn = 0; turn < 3; turn++) make().constructor;
console.log(typeof call(make), top(call(make).stack));
console.log(top(new make().stack));
function outer() {
  return new make();
}
console.log(top(outer().stack));
console.log(top(make().stack));

function renamed() {
  return new Error("m");
}
Object.defineProperty(renamed, "name", { value: "another" });
console.log(top(new renamed().stack), top(renamed().stack));

function shown() {
  return new Error("m");
}
shown.displayName = "displayed";
console.log(top(new shown().stack), top(shown().stack));

function refuses() {
  return undefined();
}
Object.defineProperty(refuses, "name", { value: "refusesUnderAnotherName" });
try {
  new refuses();
} catch (error) {
  console.log(error.name, top(error.stack));
}
try {
  refuses();
} catch (error) {
  console.log(error.name, top(error.stack));
}
function refusesToo() {
  return undefined();
}
refusesToo.displayName = "displayedToo";
function constructs() {
  return new refusesToo();
}
try {
  constructs();
} catch (error) {
  console.log(error.name, top(error.stack));
}
// Small enough to be copied into its caller.
function tiny() {
  return undefined();
}
Object.defineProperty(tiny, "name", { value: "tinyUnderAnotherName" });
function loops() {
  let last;
  for (let turn = 0; turn < 3; turn++) {
    try {
      new tiny();
    } catch (error) {
      last = error;
    }
  }
  return last;
}
console.log(top(loops().stack));
