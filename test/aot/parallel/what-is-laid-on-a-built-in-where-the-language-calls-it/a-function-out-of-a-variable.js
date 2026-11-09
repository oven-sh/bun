function describe() { return "SAID " + typeof this.allowedNodeEnvironmentFlags.has; }
Object.defineProperty(process, "toString", { value: describe });
console.log(`${process}`);
