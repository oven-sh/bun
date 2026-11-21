// A stream of node:stream is destroyed with an error, and a listener that is added behind an await still gets the error: the tick that reports it waits for the jobs.
import { Readable } from "node:stream";
const log = [];
process.on("uncaughtException", error => log.push("uncaughtException got " + error.message));
const stream = new Readable({ read() {} });
stream.on("close", () => log.push("close"));
stream.destroy(new Error("made up"));
log.push("destroyed");
await null;
log.push("behind the await");
stream.on("error", error => log.push("the listener got " + error.message));
setImmediate(() => console.log(log.join(", ")));
