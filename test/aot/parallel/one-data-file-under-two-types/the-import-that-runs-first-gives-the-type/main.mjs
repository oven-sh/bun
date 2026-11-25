// An import() with type "text" that never runs leaves an import() with type "file" of the same file its path.
const { found } = await import("./harbor.mjs");
console.log(found.default.includes("berths\"") ? "text" : "path");
const readText = () => import("./berths.json", { with: { type: "text" } });
if (globalThis.readsText) await readText();
