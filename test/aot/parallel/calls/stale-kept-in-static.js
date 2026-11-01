const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
class Job { static start = kinds[kind]; }
let result = null;
Job.start(r => { result = r; }).run();
console.log(result);
