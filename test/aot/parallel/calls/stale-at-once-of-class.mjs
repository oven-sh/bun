class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"info"')]("start");
class Handlers { open(done) { done({ ok: true }); } }
const handlers = new Handlers();
const type = "open,close".split(",")[0];
let result = null;
handlers[type](r => { result = r; });
console.log(result === null ? "null" : result.ok);
