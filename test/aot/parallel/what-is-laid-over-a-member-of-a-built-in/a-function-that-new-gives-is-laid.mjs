function Maker() {
  return function () { return typeof this.allowedNodeEnvironmentFlags.has; };
}
process.cwd = new Maker();
console.log("SAID", process.cwd());
