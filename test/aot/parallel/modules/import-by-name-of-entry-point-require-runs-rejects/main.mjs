// No import() of the program is compiled. require() runs a second entry point, which requires a third module and then throws. That module calls import() on the second entry point from a text that the build did not read: the promise is rejected with what the entry point threw.
// Entry points: ./running.mjs
try {
  require("./running.mjs");
} catch (error) {
  globalThis.thrownByRunning = error;
  console.log("require threw:", error.message);
}
console.log("main ends");
export {};
