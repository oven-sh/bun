console.log("helper");
if (!globalThis.helper) {
  globalThis.helper = 1;
  delete require.cache[require.resolve("./a.mjs")];
}
