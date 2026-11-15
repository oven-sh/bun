globalThis.runs = [];
try { require("./piece.cjs"); } catch {}
const other = require("./other.cjs");
setTimeout(() => { other.later(); import("./piece.cjs").then(() => { console.log("loaded"); other.later(); }); }, 5);
process.on("exit", () => {
  const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
  const of = m => (m ? [m.loaded, "[" + (m.children || []).map(short).join("+") + "]", short(m.parent)].join(" ") : "none");
  console.log("SAID entry", of(module));
  globalThis.runs.forEach((m, i) => console.log("SAID run", i, of(m)));
});
