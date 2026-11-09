// Bun.Transpiler runs code only for a macro. An executable that runs only its own code refuses a macro where the text calls it, and nothing that the compiler has not seen runs:
// the compiler relies on that, and a program that makes a transpiler stays closed. Plain Bun runs the macro.
// Alone: beside a program that evaluates text the macro is refused by the loader, which prints an error and sets the exit code
const fs = require("node:fs");
const path = (process.platform === "win32" ? require("node:os").tmpdir().replaceAll("\\", "/") : "/tmp") + "/bun-aot-test-macro-of-the-transpiler.ts";
fs.writeFileSync(path, "export function answer() { globalThis.leftByTheMacro = 1; Array.prototype.leftByTheMacro = 1; return 42; }\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
console.log(transpiler.transformSync("const a: number = 1; console.log(a as number);").trim().replace(/\n/g, " "));
console.log(JSON.stringify(transpiler.scanImports("import x from './y'; import('z');")));
function attempt(label, action) {
  try { console.log(label + ": " + String(action()).trim()); } catch (error) { console.log(label + ": threw"); }
}
attempt("a macro", () => transpiler.transformSync(`import { answer } from ${JSON.stringify(path)} with { type: "macro" }; console.log(answer());`));
attempt("what the macro left", () => typeof globalThis.leftByTheMacro + " " + typeof Array.prototype.leftByTheMacro);
fs.rmSync(path);
/* Output:
const a = 1; console.log(a);
[{"kind":"import-statement","path":"./y"},{"kind":"dynamic-import","path":"z"}]
a macro: threw
what the macro left: undefined undefined
*/
