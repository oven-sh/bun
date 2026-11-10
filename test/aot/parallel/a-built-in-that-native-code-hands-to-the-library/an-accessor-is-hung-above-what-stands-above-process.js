Object.setPrototypeOf(Object.getPrototypeOf(process), { get madeUp() { return typeof this.allowedNodeEnvironmentFlags.has; } });
console.log("SAID", process.madeUp);
