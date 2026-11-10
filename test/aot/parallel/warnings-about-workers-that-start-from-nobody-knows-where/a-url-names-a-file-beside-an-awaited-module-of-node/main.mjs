// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// STATISTIC: SourceFilesInferred = 1
// No Worker can start here, so the file that the URL names is no entry point. It was compiled for a Worker that nobody makes.
const { isMainThread } = await import("node:worker_threads");
const beside = new URL("./beside.mjs", import.meta.url);
console.log(isMainThread, beside.pathname.endsWith("/beside.mjs"));
