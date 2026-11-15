Object.defineProperty(process, "title", {
  configurable: true,
  value: function () { return typeof this.allowedNodeEnvironmentFlags.has; },
});
console.log("SAID", process.title());
