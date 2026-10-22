// Species: proxy programs  a handler of performance is stored under a computed key. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; } step() { return ++this.hits; } }
const body = new Body(); body.step();
const key = process.argv.length > 99 ? "x" : "onresourcetimingbufferfull";
globalThis.__perf = performance;
globalThis.__perf[key] = function (event) { log.push(typeof event); body.hits = "s"; };
log.push(typeof performance.onresourcetimingbufferfull, String(body.step()));
performance.onresourcetimingbufferfull({}); log.push(String(body.step()));
console.log(log.join("; "));
