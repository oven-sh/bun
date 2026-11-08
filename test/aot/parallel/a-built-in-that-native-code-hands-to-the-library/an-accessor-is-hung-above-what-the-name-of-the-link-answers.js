Object.setPrototypeOf(process.__proto__, { get madeUp() { return typeof this.allowedNodeEnvironmentFlags.has; } });
console.log("SAID", process.madeUp);
