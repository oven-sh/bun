// The first of two imported CommonJS files lacks the imported name. Both files run before the link fails.
globalThis.ran = [];
try {
  await import("./importer.mjs");
} catch (error) {
  console.log(error.constructor.name, globalThis.ran.sort().join());
}
