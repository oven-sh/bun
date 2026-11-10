// `bun <file>` makes no stream for a warning that it does not print, so nothing comes to stand above `process`.
process.noDeprecation = true;
console.log("before", typeof process._eventsCount);
process.emitWarning("made-up words", "DeprecationWarning", "DEP_MADE_UP");
await new Promise(resolve => setImmediate(resolve));
console.log("behind one that is switched off", typeof process._eventsCount);
process.removeAllListeners("warning");
process.emitWarning("more made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind one that nobody hears", typeof process._eventsCount);
