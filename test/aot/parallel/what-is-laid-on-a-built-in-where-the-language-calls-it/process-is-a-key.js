Object.defineProperty(process, "toString", { value() { return "SAID " + typeof this.allowedNodeEnvironmentFlags.has; } });
const shelf = {};
shelf[process] = 1;
console.log(Object.keys(shelf).join());
