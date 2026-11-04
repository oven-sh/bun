const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
const jobs = [kinds[kind]];
let result = null;
jobs[0](r => { result = r; }).run();
console.log(result);
