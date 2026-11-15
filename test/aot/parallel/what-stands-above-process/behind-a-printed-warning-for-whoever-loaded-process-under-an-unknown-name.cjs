// The loader hands `process` out under a name that the build cannot know.
const held = require(JSON.parse('"process"'));
console.log("before", held === process, held._eventsCount);
process.emitWarning("made-up words");
setImmediate(() => console.log("behind", held._eventsCount));
