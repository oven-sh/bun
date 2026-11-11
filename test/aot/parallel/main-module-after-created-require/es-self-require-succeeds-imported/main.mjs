import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function report(word) {
  const runs = globalThis.runs ?? [];
  console.log(word, "| objects", runs.length);
  runs.forEach((m, i) => console.log("run" + i, "id", m.id === "." ? "." : String(m.id).split("/").pop(), "| parent", m.parent === null ? "null" : typeof m.parent));
}
await import("./piece.mjs").catch(() => {});
report(await import("./late.cjs").then(() => "loaded", e => "rejected " + e.message));
