// performance is kept under a name of the global object and read back, and a handler is stored on it under a key that the build does not know. The getter of the host answers the handler.
const log = [];
class Body { constructor() { this.hits = 1; } step() { return ++this.hits; } }
const body = new Body(); body.step();
const key = process.argv.length > 99 ? "x" : "onresourcetimingbufferfull";
globalThis.__perf = performance;
globalThis.__perf[key] = function (event) { log.push(typeof event); body.hits = "s"; };
log.push(typeof performance.onresourcetimingbufferfull, String(body.step()));
performance.onresourcetimingbufferfull({}); log.push(String(body.step()));
console.log(log.join("; "));
