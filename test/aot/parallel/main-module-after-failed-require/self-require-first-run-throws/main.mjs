import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function name(m) { const runs = globalThis.runs ?? []; return m === undefined ? "undefined" : m === null ? "null" : runs.includes(m) ? "run" + runs.indexOf(m) : typeof m === "object" && m.id ? "module:" + String(m.id).split("/").pop() : typeof m; }
function report(word) {
  const runs = globalThis.runs ?? [];
  console.log(word, "| bodies", globalThis.bodies, "| objects", runs.length);
  runs.forEach((m, i) => console.log("run" + i, "id", m.id === "." ? "." : String(m.id).split("/").pop(), "| parent", name(m.parent), "| children", m.children.map(name).join(",") || "none", "| isMain", m.require ? m.require.main === m : "-"));
}
  try { require("./piece.cjs"); } catch {}
  report(await import("./piece.cjs").then(() => "loaded", e => "rejected " + e.message));
