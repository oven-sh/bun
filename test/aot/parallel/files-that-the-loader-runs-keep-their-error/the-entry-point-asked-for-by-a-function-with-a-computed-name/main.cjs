// Differs from `bun run` by design: docs/compiler/compatibility.mdx, "A CommonJS file that has thrown runs again".
// a function of the entry point loads by a name that is known only at run time, and the name is the entry point's
globalThis.runs = (globalThis.runs ?? 0) + 1;
let total = 0;
function loadLater(name) {
  total++;
  return require(name);
}
if (globalThis.runs === 1) {
  process.on("uncaughtException", (error) => {
    console.log("caught:", error.message);
    try { console.log("again:", loadLater("./main" + ".cjs").value, total); } catch (second) { console.log("again threw:", second.message, second === error, total, globalThis.runs); }
  });
  throw new Error("first run");
}
exports.value = globalThis.runs;
/* Output:
caught: first run
again threw: first run true 1 1
*/
