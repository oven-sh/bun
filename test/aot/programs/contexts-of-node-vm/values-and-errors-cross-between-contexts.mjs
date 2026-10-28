// Values of the program are tested in a context of node:vm, errors leave it, a loop in it is timed out, and its text evaluates text.
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
const context = vm.createContext({ outer: [1, 2], make: () => ({ a: 1 }) });
await show("instanceof", () => vm.runInContext("[outer instanceof Array, Array.isArray(outer), make() instanceof Object, [] instanceof Array]", context));
await show("an error leaves", () => { try { vm.runInContext("null.x", context); } catch (error) { return [error instanceof TypeError, error.name, typeof error.stack]; } });
await show("a syntax error", () => { try { vm.runInContext("(", context); } catch (error) { return [error instanceof SyntaxError, error.name]; } });
await show("timeout", () => { try { vm.runInContext("for (;;);", context, { timeout: 5 }); } catch (error) { return [error.code, error.name]; } });
await show("isContext", () => [vm.isContext(context), vm.isContext({})]);
await show("cachedData", () => { const script = new vm.Script("1 + 1", { produceCachedData: true }); return [typeof script.createCachedData, script.runInThisContext()]; });
await show("measureMemory", () => typeof vm.measureMemory);
await show("contextified writes", () => { vm.runInContext("var made = 1; globalThis.other = 2; function f() {}", context); return [context.made, context.other, typeof context.f]; });
await show("eval inside", () => vm.runInContext("[eval('1 + 1'), new Function('return 2')(), (0, eval)('typeof globalThis.outer')]", context));
await show("codeGeneration", () => { try { return vm.runInNewContext("eval('1')", {}, { contextCodeGeneration: { strings: false } }); } catch (error) { return error.name; } });
