const kinds = {
  go(done) { return { run() { done("go"); } }; },
  stop(done) { return { run() { done("stop"); } }; },
};
const kind = JSON.parse('{"kind":"stop"}').kind;
const start = kinds[kind];
let result = null;
start(r => { result = r; }).run();
console.log(result);
