class Logger { info(line) {} }
const logger = new Logger();
logger[JSON.parse('"info"')]("start");
const handlers = { open(done) { done({ ok: true }); } };
function work() {
  const type = "open,close".split(",")[0];
  let result = null;
  handlers[type](r => { result = r; });
  return result;
}
const answer = work();
console.log(answer === null ? "null" : answer.ok);
