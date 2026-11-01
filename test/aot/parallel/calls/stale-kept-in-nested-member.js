const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
const job = { inner: { start: kinds[kind] } };
let result = null;
job.inner.start(r => { result = r; }).run();
console.log(result);
