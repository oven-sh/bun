// Neither function has a `this` of its own: `process` is handed to nobody.
// STATISTIC: FunctionsLowered <= 700
process.cwd = function () { return "made up"; };
Object.defineProperty(process, "uptime", { value: () => 7, configurable: true, writable: true });
console.log("SAID", process.cwd(), process.uptime());
