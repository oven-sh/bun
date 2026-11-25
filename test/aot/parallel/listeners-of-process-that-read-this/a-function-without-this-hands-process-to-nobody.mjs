// No `this` of its own stands in the listener, and the `this` of the function inside it is another: `process` is handed to nobody.
// STATISTIC: FunctionsLowered <= 700
process.on("exit", function () {
  function inner() {
    return typeof this;
  }
  console.log("SAID", inner());
});
process.once("exit", () => console.log("SAID", "bye"));
