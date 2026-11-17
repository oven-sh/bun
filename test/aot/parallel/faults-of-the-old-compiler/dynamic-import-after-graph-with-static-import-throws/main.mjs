// Reference: bun build --compile
// A dynamically imported graph throws before the file with the static import as TOML runs. An executable has the file as one module, of the type that the scan of the bundler comes to first: the import() as text of this file.
// Under `bun run` the graph was loaded first, so the call gets the TOML module.
let message;
try {
  await import("./bad.mjs");
} catch (error) {
  message = error.message;
}
const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(message, typeof loaded.default, Object.keys(loaded).sort().join());
