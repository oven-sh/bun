// As dispatch-by-name.mjs, but the call through the table stands in a helper: it returns what the handler returns.
const handlers = {
  open(done) { return { run() { done({ ok: true }); } }; },
  close(done) { return { run() { done({ ok: false }); } }; },
};
const type = JSON.parse('{"type":"open"}').type;
function dispatch(kind, done) { return handlers[kind](done); }
function request(weight) {
  let result = null;
  dispatch(type, r => { result = r; }).run();
  return JSON.stringify(result) + weight;
}
console.log(request(Number(process.argv[2] ?? 1)));
