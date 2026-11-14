import("./file.cjs").then(async file => {
  console.log("then:", Object.keys(file).join(" "));
  globalThis.later("behind the end of the file");
  await import("./imports-later.mjs");
  globalThis.later("behind a later importer");
});
