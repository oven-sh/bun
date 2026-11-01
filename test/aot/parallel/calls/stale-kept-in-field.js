const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
class Job { start = kinds[kind]; }
const job = new Job();
let result = null;
job.start(r => { result = r; }).run();
console.log(result);
