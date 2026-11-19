const handlers = {
  open(done) { return { run() { done({ ok: true }); } }; },
  close(done) { return { run() { done({ ok: false }); } }; },
};
const type = JSON.parse('{"type":"open"}').type;
let result = null;
handlers[type](r => { result = r; }).run();
console.log(JSON.stringify(result));
