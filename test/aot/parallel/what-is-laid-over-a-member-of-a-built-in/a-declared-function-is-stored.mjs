function left() { return typeof this.allowedNodeEnvironmentFlags.has; }
process.cwd = left;
console.log("SAID", process.cwd());
