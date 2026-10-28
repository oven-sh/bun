// vm.compileFunction() with parameters, in a context, with context extensions, and with an import() in the text.
import "node:path";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
await show("parameters", () =>
  vm.compileFunction("return a + b + typeof require + typeof process", ["a", "b"])(1, 2),
);
await show("in a context", () =>
  vm.compileFunction("return [a, typeof Array.prototype.flat, typeof process]", ["a"], {
    parsingContext: vm.createContext({}),
  })(1),
);
await show("extensions", () => vm.compileFunction("return x + y", [], { contextExtensions: [{ x: 1 }, { y: 2 }] })());
await show(
  "import()",
  async () =>
    typeof (
      await vm.compileFunction("return import('node:path')", [], {
        importModuleDynamically: specifier => import(specifier),
      })()
    ).join,
);
