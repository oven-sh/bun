// A closure throws, then gets a name through what came back out of a text made at run time, and the stacks are read at the end. Each line: the names in the first frames.
// Flags: --aot-limit=MaxWarmCodeValues:1
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const errors = [];
for (const name of ["", "second", "", "fourth", "fifth"]) {
  const f = function written() {
    throw new Error("x");
  };
  try {
    f();
  } catch (error) {
    errors.push(error);
  }
  if (name) handedBack(f).displayName = name;
}
console.log(errors.map(error => firstFrame(error.stack)).join(" | "));
