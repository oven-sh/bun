// A function of the program runs while an import() first loads library modules. The stack that it takes ends at the module that
// was asked for.
const stacks = [];
const note = title =>
  function () {
    stacks.push(title + "\n" + new Error("seen").stack);
  };
Object.defineProperty(Map.prototype, "added", { configurable: true, value: note("Map") });
const show = title => {
  console.log(title, stacks.length);
  for (const stack of stacks.splice(0)) console.log(stack.replaceAll(import.meta.dirname, ""));
};
async function load() {
  const util = await import("node:util");
  return typeof util.inspect;
}
console.log(await load());
show("import() in an async function");
console.log(await load());
show("the same again");
delete Map.prototype.added;
