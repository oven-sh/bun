console.log("helper");
const run = () => {
  delete require.cache[require.resolve("./dep.mjs")];
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
