class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"info"')]("start");
const handlers = { open(done) { done(7); } };
const type = "open,close".split(",")[0];
let result = 0;
handlers[type](r => { result = r; });
console.log(result);
