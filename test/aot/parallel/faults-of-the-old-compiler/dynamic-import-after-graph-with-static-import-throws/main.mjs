// A dynamically imported graph throws before the file with the static import as TOML runs. The graph was loaded, so a later import() as text gets the TOML module.
let message;
try {
  await import("./bad.mjs");
} catch (error) {
  message = error.message;
}
const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(message, typeof loaded.default, Object.keys(loaded).sort().join());
