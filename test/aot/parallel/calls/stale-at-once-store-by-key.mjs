class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"level"')] = 1;
const handlers = { open(done) { done({ ok: true }); } };
const type = "open,close".split(",")[0];
let result = null;
handlers[type](r => { result = r; });
console.log(result === null ? "null" : result.ok, logger.level);
