Object.defineProperties(process, { cwd: { value() { return typeof this.allowedNodeEnvironmentFlags.has; }, configurable: true, writable: true } });
console.log("SAID", process.cwd());
