// process.off() answers `process`.
const held = process.off("madeUp", () => {});
console.log("before", held._eventsCount, Object.getPrototypeOf(Object.getPrototypeOf(held)) === Object.prototype);
process.emitWarning("made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind", held._eventsCount, Object.getPrototypeOf(Object.getPrototypeOf(held)) === Object.prototype);
