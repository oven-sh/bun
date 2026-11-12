// A text that is put together at run time gives each function object of one function a name. Prints the frames of each.
const top = stack =>
  String(stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 2)
    .map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
function make() {
  return function () {
    return new Error("x").stack;
  };
}
const rename = new Function("f", "n", ["Object.defineProperty(f, 'na", "me', { value: 'given' + n })"].join(""));
const made = [make(), make(), make()];
made.forEach((f, n) => rename(f, n));
console.log(made.map(f => top(f())).join(" / "));
