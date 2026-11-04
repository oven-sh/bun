// To `bun run` a name that a function in a block declares is that function's wherever the file writes it, so it is no sign of CommonJS.
const files = [
  ["module-behind", () => import("./module-behind.js")],
  ["exports-behind", () => import("./exports-behind.js")],
  ["module-ahead", () => import("./module-ahead.js")],
  ["exports-ahead", () => import("./exports-ahead.js")],
  ["under-if", () => import("./under-if.js")],
  ["in-a-switch", () => import("./in-a-switch.js")],
  ["exports-beside-module", () => import("./exports-beside-module.js")],
  ["module-beside-exports", () => import("./module-beside-exports.js")],
];
for (const [name, load] of files) {
  globalThis.mode = "none";
  try {
    const namespace = await load();
    console.log(name, Object.keys(namespace).join("+") || "none", typeof namespace.default, globalThis.mode);
  } catch (error) {
    console.log(name, error.name + ": " + error.message, globalThis.mode);
  }
}
