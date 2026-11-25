function Maker() {
  return function () { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); };
}
process.on("exit", new Maker());
console.log("SAID begun");
