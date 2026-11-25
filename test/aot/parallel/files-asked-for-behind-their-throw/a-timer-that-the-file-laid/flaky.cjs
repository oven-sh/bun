globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs === 1) {
  setTimeout(() => { try { console.log("timer:", require("./flaky.cjs").value); } catch (error) { console.log("timer threw:", error.message); } }, 0);
  throw new Error("first run");
}
exports.value = globalThis.runs;
