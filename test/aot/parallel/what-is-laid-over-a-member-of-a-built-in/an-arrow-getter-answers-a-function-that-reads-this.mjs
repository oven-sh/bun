Object.defineProperty(process, "cwd", {
  configurable: true,
  get: () => function () { return typeof this.allowedNodeEnvironmentFlags.has; },
});
console.log("SAID", process.cwd());
