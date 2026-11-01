const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
const job = { start: kinds[kind] };
let result = null, count = 0;
job.start(r => { result = r; count++; }).run();
const first = result;
job.start(r => { result = r + "!"; count++; }).run();
console.log(first, result, count);
