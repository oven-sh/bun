// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The engine calls this start nameless, and that is warned of. The two URLs add no second line.
let url = new URL("./first.mjs", process.argv[5] ?? import.meta.url);
if (process.argv.length > 6) url = new URL("./second.mjs", process.argv[6]);
if (process.argv.length > 7) new Worker(url);
console.log("none started");
