globalThis.runs = [];
try { require("./piece.cjs"); } catch {}
try { require("./leaf.mjs"); } catch {}
import("./piece.cjs").then(() => console.log("loaded"), e => console.log("rejected", e && e.name));
console.log("main ends");
process.on("exit", () => {
  const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
  const of = m => (m ? [m.loaded, "[" + (m.children || []).map(short).join("+") + "]", short(m.parent)].join(" ") : "none");
  console.log("SAID entry", of(module));
  globalThis.runs.forEach((m, i) => console.log("SAID run", i, of(m)));
});
