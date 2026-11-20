console.log(Reflect.defineProperty(process, "toString", { value() { return "SAID " + typeof this.allowedNodeEnvironmentFlags.has; } }));
console.log(`${process}`);
