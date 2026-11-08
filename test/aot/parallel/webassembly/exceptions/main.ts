// Both forms of exception handling, each in a module of its own: what is thrown and caught inside a module, what comes in from JavaScript, and what goes out to it.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import legacyPath from "./legacy.wasm";
import tablesPath from "./tables.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}
async function moduleAt(path: string) {
  return new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

const wasm: any = WebAssembly;
const env = { fail: (n: number) => { if (n) throw new RangeError("thrown by JavaScript: " + n); } };
const legacy = new WebAssembly.Instance(await moduleAt(legacyPath), { env }).exports as any;
console.log("catchPair", legacy.catchPair(3, 0.5), legacy.catchPair(-1, 1e300));
console.log("catchWide", legacy.catchWide(1n << 40n, 2.75), legacy.catchWide(-5n, -1.5));
console.log("rethrows", legacy.rethrows(0), legacy.rethrows(1));
console.log("delegates", legacy.delegates());
console.log("catchesJavaScript", legacy.catchesJavaScript(0), legacy.catchesJavaScript(9));
try {
  legacy.letsOut(7, 2.5);
} catch (error: any) {
  console.log("letsOut", error instanceof wasm.Exception, error.is(legacy.pair), error.getArg(legacy.pair, 0), error.getArg(legacy.pair, 1));
}
console.log("keepsLocals", legacy.keepsLocals(1), legacy.keepsLocals(10), legacy.keepsLocals(100000));
console.log("trapIsNotCaught", legacy.trapIsNotCaught(1), outcomeOf(() => legacy.trapIsNotCaught(0)));

const tables = new WebAssembly.Instance(await moduleAt(tablesPath), { env }).exports as any;
console.log("catches", tables.catches(5), tables.catches(-5));
console.log("catchesAll", tables.catchesAll(0), tables.catchesAll(1));
console.log("catchesRefAndThrowsAgain", tables.catchesRefAndThrowsAgain(11));
console.log("catchesAllRef", tables.catchesAllRef());
console.log("throwsNull", outcomeOf(() => tables.throwsNull()));
console.log("firstMatch", tables.firstMatch(0), tables.firstMatch(1), tables.firstMatch(2));
try {
  tables.letsOut(8);
} catch (error: any) {
  console.log("letsOut", error instanceof wasm.Exception, error.getArg(tables.value, 0));
}
let total = 0;
for (let i = 0; i < 20000; i++) total = (total + legacy.catchPair(i, 0.5) + tables.catches(i) + tables.firstMatch(i & 3) + legacy.rethrows(i & 1)) | 0;
console.log("many", total);
