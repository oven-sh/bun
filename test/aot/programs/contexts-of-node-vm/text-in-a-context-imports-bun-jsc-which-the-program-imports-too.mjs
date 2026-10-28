// A text that runs in a context of node:vm imports bun:jsc, which the program imports too, through a loader that is a function and through the loader of the main context.
import * as named from "bun:jsc";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
console.log(typeof named);
const text = "import('bun:jsc')";
for (const [loader, importModuleDynamically] of [
  ["a function", specifier => import(specifier)],
  ["the main loader", vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER],
]) {
  const options = { importModuleDynamically };
  for (const [way, run] of [
    ["runInNewContext", () => vm.runInNewContext(text, {}, options)],
    ["runInContext", () => vm.runInContext(text, vm.createContext({}), options)],
    ["a Script", () => new vm.Script(text, options).runInNewContext({})],
  ]) {
    await show(`${way}, ${loader}:`, async () => {
      const found = await run();
      return typeof found.heapStats;
    });
  }
}
