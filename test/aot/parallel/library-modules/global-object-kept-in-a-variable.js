// What TypeScript makes of `globalThis.registry ??= {}`: the global object is stored in a variable, and the variable is only read by constant names. Every use of it is in sight, and none of them needs Bun's library.
// STATISTIC: FunctionsLowered <= 600
var _a;
const registry = (_a = globalThis).__registry_of_this_program ?? (_a.__registry_of_this_program = { entries: [] });
registry.entries.push("one");
console.log(globalThis.__registry_of_this_program.entries.join(), typeof _a.process.pid);
