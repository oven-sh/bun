// Two instances of one program give properties to closures of the same functions under the same names: each has its own Structures.
const lost = [x => x];
globalThis.pass = value => lost.length > 5 ? null : value;
const makers = [
  i => globalThis.pass(function named(a, b) { return i + (a | 0); }),
  i => globalThis.pass(a => i + (a | 0)),
  i => globalThis.pass(async () => i),
  i => globalThis.pass({ method(a) { return i; } }.method),
];
const hooks = [x => x + 1, function (x) { return x * 2; }];
hooks[0].priority = 1;
const keys = ["alpha", "beta", Symbol.for("gamma")];
function work(rounds) {
  let sum = 0;
  const shapes = new Set();
  for (let i = 0; i < rounds; i++) {
    const f = makers[i & 3](i);
    f.label = i;
    const g = makers[(i + 1) & 3](i);
    g[keys[i % 3]] = i;
    const h = makers[(i + 2) & 3](i);
    h.label = 1;
    delete h.label;
    h.other = 2;
    sum += f.label + g[keys[i % 3]] + h.other + (f(1) instanceof Promise ? 1 : 2);
    for (const hook of hooks) sum += hook(i) + (hook.priority | 0);
    shapes.add([f, g, h].map(x => Reflect.ownKeys(x).map(String).join() + (Object.getPrototypeOf(x) === Function.prototype || Object.getPrototypeOf(Object.getPrototypeOf(x)) === Function.prototype) + (x.prototype ? x.prototype.constructor === x : "")).join(";"));
    if (i % 400 === 200) Bun.gc(true);
  }
  return sum + " " + [...shapes].sort().join("|").length + " " + shapes.size;
}
if (Bun.isMainThread) {
  console.log("before", work(300));
  const answers = [];
  const workers = [0, 1].map(() => new Worker(new URL(import.meta.url)));
  for (const worker of workers) answers.push(new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
  for (const worker of workers) worker.postMessage(1500);
  console.log("beside", work(1500));
  for (const answer of answers) console.log("worker", await answer);
  console.log("again", work(800));
  for (const worker of workers) worker.terminate();
  console.log("behind", work(800));
} else {
  addEventListener("message", event => postMessage(work(event.data)));
}
