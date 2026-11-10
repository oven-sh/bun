// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load reads the name, and nothing lies there. A path that finds no file is warned of in the same words.
if (process.argv.length > 5) new Worker(new URL("./no-such-job.mjs", import.meta.url));
console.log("none started");
