// Build prints: 2 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
if (process.argv.length > 6) new Worker(new URL(process.argv[5], import.meta.url));
if (process.argv.length > 6) new Worker(new URL(process.argv[6]));
console.log("none started");
