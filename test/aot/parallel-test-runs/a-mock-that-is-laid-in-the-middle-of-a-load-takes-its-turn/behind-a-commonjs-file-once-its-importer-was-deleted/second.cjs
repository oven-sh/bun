console.log("second");
if (!globalThis.s) {
  globalThis.s = 1;
  delete require.cache[require.resolve("./reads.mjs")];
}
