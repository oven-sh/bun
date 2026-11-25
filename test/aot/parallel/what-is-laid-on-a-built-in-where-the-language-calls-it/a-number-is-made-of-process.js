Object.defineProperty(process, "valueOf", { value() { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); return 1; } });
console.log(+process);
