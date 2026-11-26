console.log("h2");
if (!globalThis.h2) {
  globalThis.h2 = 1;
  delete require.cache[require.resolve("./b.mjs")];
}
