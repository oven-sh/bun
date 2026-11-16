// A generator of a text, and one of the program, whose run the time limit of a script cuts short: both count as running from then on, whoever has resumed them.
const vm = require("node:vm"); const part = process.argv.length > 99 ? "x" : "";
globalThis.spin = new Function("return function* spin() { globalThis.entered = true; for (let n = 0; n < 1e12; n++) if (n === -1) yield n; }" + part)();
function* own() { globalThis.entered = true; for (let n = 0; n < 1e12; n++) if (n === -1) yield n; }
const say = f => { try { const r = f(); return JSON.stringify(r); } catch (e) { return e.name + ": " + e.message; } };
for (const [name, g] of [["text", globalThis.spin], ["compiled", own]]) for (const how of ["script", "compiled caller", "for-of", "spread", "yield*", "return", "throw"]) {
  let it; for (let t = 0; t < 40; t++) { it = globalThis.it = g(); globalThis.entered = false; globalThis.runs = how === "for-of" ? () => { for (const v of it) return v; } : how === "spread" ? () => [...it] : how === "yield*" ? () => (function* () { yield* it; })().next() : how === "compiled caller" ? () => it.next() : null;
    try { vm.runInThisContext(how === "script" || how === "return" || how === "throw" ? "it.next()" : "runs()", { timeout: 5 }); } catch (e) { if (e.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") console.log("other", e.name, e.message); }
    if (globalThis.entered) break; }
  console.log(name, how, globalThis.entered, how === "return" ? say(() => it.return(5)) : how === "throw" ? say(() => it.throw(new Error("q"))) : say(() => it.next()), say(() => it.next()));
}
