class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"info"')]("start");
const handlers = { open(done) { done({ ok: true }); }, close(done) { done({ ok: false }); } };
const type = "open,close".split(",")[1];
let result = null;
handlers[type](r => { result = r; });
console.log(result === null ? "null" : result.ok);
