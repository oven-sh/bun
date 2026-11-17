// `process` has gone out of the compiler's sight: through a list, under a key of the global object that nobody knows, and as the `this` of a listener.
const [held] = [process];
const found = globalThis[JSON.parse('"process"')];
process.on("madeUp", function () {
  console.log("a listener", this._eventsCount, "_eventsCount" in this);
});
console.log("before", held._eventsCount, found._eventsCount);
process.emit("madeUp");
process.emitWarning("made-up words");
await new Promise(resolve => setImmediate(resolve));
console.log("behind", held._eventsCount, found._eventsCount);
process.emit("madeUp");
