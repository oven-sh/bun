// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load has followed the name under `preload` to its file. That says nothing about the file that the Worker starts from.
if (process.argv.length > 5) new Worker(process.argv[5], { preload: "./first.mjs" });
console.log("none started");
