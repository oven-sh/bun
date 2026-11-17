import("./file.cjs").then(async () => {
  globalThis.later("behind the end of the file");
  await import("./imports-later.mjs");
  globalThis.later("behind a later importer");
});
