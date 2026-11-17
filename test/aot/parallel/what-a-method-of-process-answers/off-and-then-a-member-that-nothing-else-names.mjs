// process.off() answers `process`. Whoever holds the answer holds all that `process` can do, also what the program names nowhere on `process` itself.
const held = process.off("madeUp", () => {});
console.log(held === process, typeof held.allowedNodeEnvironmentFlags.has, typeof held.report.getReport);
