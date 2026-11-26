console.log("h1");
if (!globalThis.h1) {
  globalThis.h1 = 1;
  delete require.cache[require.resolve("./b.cjs")];
}
