// A text that is put together at run time gives each closure of one function a name. Each line: the names in the first frames of the closures. The stored output lists every closure that is called where the build knows the callee under the name that was given last.
// Alone: which calls record their callee follows from what else is in the executable
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const rename = new Function("f", "n", ["Object.defineProperty(f, 'na", "me', { value: 'given' + n })"].join(""));
{
  function make() {
    return function () {
      return new Error("x").stack;
    };
  }
  const made = [make(), make(), make()];
  made.forEach((f, n) => rename(f, n));
  console.log("all three are named |", made.map(f => firstFrame(f())).join(" | "));
}
{
  function make() {
    return function written() {
      return new Error("x").stack;
    };
  }
  const made = [make(), make(), make()];
  rename(made[1], 1);
  console.log("the second is named |", made.map(f => firstFrame(f())).join(" | "));
}
/* Output:
all three are named | at given2 | at given2 | at given2
the second is named | at given1 | at given1 | at given1
*/
