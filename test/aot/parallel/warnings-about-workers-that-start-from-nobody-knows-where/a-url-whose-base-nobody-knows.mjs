// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
const base = process.env.BASE_OF_JOBS ?? import.meta.url;
if (process.argv.length > 5) new Worker(new URL("./job.mjs", base));
console.log("none started");
