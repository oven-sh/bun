// The same for an `import()` that nobody waits for, and whose importer schedules in the turn that calls it.
const log: string[] = ["importer"];
import("./imported.ts");
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
export {};
