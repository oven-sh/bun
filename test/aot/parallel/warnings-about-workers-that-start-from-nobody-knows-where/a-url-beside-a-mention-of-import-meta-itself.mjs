// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// What is handed `import.meta` itself may change its `url`, so the load reads no file off the URL. The engine names such a start by its URL alone, and nothing was said of it.
console.log(typeof import.meta);
if (process.argv.length > 5) new Worker(new URL("./job.mjs", import.meta.url));
console.log("none started");
