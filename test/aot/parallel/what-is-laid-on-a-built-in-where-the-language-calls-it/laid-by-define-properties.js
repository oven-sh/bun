Object.defineProperties(process, { toString: { value() { return "SAID " + typeof this.allowedNodeEnvironmentFlags.has; } } });
console.log(`${process}`);
