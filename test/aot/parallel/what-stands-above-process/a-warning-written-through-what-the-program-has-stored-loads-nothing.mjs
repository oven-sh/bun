// The program has stored an object of its own in the place of process.stderr. `bun <file>` writes the warning through that and makes no stream, so nothing comes to stand above `process`.
const written = [];
process.stderr = { write: text => written.push(text) };
console.log("before", typeof process._eventsCount);
process.emitWarning("made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind", typeof process._eventsCount, written.length, written[0].includes("made-up words"));
