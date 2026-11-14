// Callbacks that left sight call each other to a great depth with no limit on the stack that is kept. The outermost gets its name behind the stack.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const kept = [];
Error.stackTraceLimit = Infinity;
const made = [];
function make(depth) {
  const level = handedBack(function level(value) {
    if (!depth) {
      kept.push(new Error(value));
      return 0;
    }
    return 1 + make(depth - 1)(value);
  });
  made.push(level);
  return level;
}
console.log(make(2000)("a"));
give(made[0], "outermost");
give(made[1000], "middle");
give(made[2000], "innermost");
const whole = kept[0].stack.split("\n").map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""));
console.log(whole.filter(name => name === "level").length, whole.indexOf("innermost"), whole.indexOf("middle"), whole.indexOf("outermost"));
