function name(m) { const runs = globalThis.runs ?? []; return m === undefined ? "undefined" : m === null ? "null" : m === module ? "main" : m === globalThis.leaf ? "leaf" : m === globalThis.maker ? "maker" : runs.includes(m) ? "run" + runs.indexOf(m) : "another(" + require("node:path").basename(String(m.id)) + ")"; }
function report(word) {
  const runs = globalThis.runs ?? [];
  console.log(word, "| bodies", globalThis.bodies, "| objects", runs.length);
  runs.forEach((m, i) => console.log("run" + i, "children", m.children.map(name).join(",") || "none", "| parent", name(m.parent)));
  if (globalThis.maker) console.log("maker children", globalThis.maker.children.map(name).join(",") || "none");
  console.log("main children", module.children.map(name).join(",") || "none");
}
try { require("./piece.cjs"); } catch {}
import("./piece.cjs").then(() => "loaded", e => "rejected " + e.message).then(report);
console.log("main ends");
