// To print a warning, `bun <file>` makes process.stderr, whose modules load node:events, and that puts its EventEmitter.prototype above the prototype of `process`.
// An executable writes the warning without making the stream. What stands above `process` behind the warning is the same all the same.
console.log("before", typeof process._eventsCount, "_eventsCount" in process);
process.emitWarning("made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind a warning", typeof process._eventsCount, "_eventsCount" in process);
process.emitWarning("more made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind a second one", typeof process._eventsCount, "_eventsCount" in process);
process.stderr.write("");
console.log("behind a write", typeof process._eventsCount, "_eventsCount" in process);
