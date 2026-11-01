const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
function work() {
  const job = { start: kinds[kind] };
  let result = null;
  job.start(r => { result = r; }).run();
  return result;
}
console.log(work());
