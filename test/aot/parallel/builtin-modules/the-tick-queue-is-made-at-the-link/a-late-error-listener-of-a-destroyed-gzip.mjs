// A stream of node:zlib is destroyed with an error, and a listener that is added behind an await still gets the error: the tick that reports it waits for the jobs.
import zlib from "node:zlib";
const log = [];
process.on("uncaughtException", error => log.push("uncaughtException got " + error.message));
const gzip = zlib.createGzip();
gzip.on("close", () => log.push("close"));
gzip.destroy(new Error("made up"));
log.push("destroyed");
await null;
log.push("behind the await");
gzip.on("error", error => log.push("the listener got " + error.message));
setImmediate(() => console.log(log.join(", ")));
