function name(m) { const runs = globalThis.runs ?? []; return m === undefined ? "undefined" : m === null ? "null" : m === module ? "main" : m === globalThis.leaf ? "leaf" : runs.includes(m) ? "run" + runs.indexOf(m) : typeof m; }
function report(word) {
  const runs = globalThis.runs ?? [];
  console.log(word, "| bodies", globalThis.bodies, "| objects", runs.length, "| same", runs.length > 1 ? runs[0] === runs[1] : "-");
  runs.forEach((m, i) => console.log("run" + i, "children", m.children.map(name).join(",") || "none", "| parent", name(m.parent), "| loaded", m.loaded));
  console.log("main children", module.children.map(name).join(",") || "none");
}
try { require("./piece.cjs"); } catch {}
import("./wrap.mjs").then(() => "loaded", e => "rejected " + e.message).then(report);
console.log("main ends");
