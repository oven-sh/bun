// What stands above `process` is written to: a getter there gets `process` as `this`. All that `process` can do stays.
const above = Object.getPrototypeOf(process);
Object.defineProperty(above, "allOfIt", { get() { return this; }, configurable: true });
process.allOfIt.stdout.write("through a getter on the object above\n");
