class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"info"')]("start");
const handlers = { open(done) { done({ ok: true }); } };
const type = ["op", "en"].join("");
let result = null;
handlers[type](r => { result = r; });
console.log(result === null ? "null" : result.ok);
