Object.defineProperty(process, "exit", { value(code) { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); }, configurable: true, writable: true });
process.nextTick(() => { process.exit(0); });
