// require() runs a module that imports another one. It requires a third module, which calls import() on the first, and then it throws. The promise is rejected with what the first module threw.
try {
  require("./running.mjs");
} catch (error) {
  globalThis.thrownByRunning = error;
  console.log("require threw:", error.message);
}
console.log("main ends");
export {};
