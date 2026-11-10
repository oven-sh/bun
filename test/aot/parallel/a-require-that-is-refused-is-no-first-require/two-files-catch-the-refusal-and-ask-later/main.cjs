globalThis.runs = [];
const one = require("./one.cjs"), two = require("./two.cjs");
setTimeout(() => { one.later(); two.later(); one.later(); two.later(); }, 5);
process.on("exit", () => {
  const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
  const of = m => (m ? [m.loaded, "[" + (m.children || []).map(short).join("+") + "]", short(m.parent)].join(" ") : "none");
  console.log("SAID entry", of(module));
  globalThis.runs.forEach((m, i) => console.log("SAID run", i, of(m)));
});
