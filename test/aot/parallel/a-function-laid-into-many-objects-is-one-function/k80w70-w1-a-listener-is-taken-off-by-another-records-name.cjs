const { EventEmitter } = require("node:events");
let calls = 0;
function measure(n) { calls++; return n * 2; }
function jobs(start, count) {
  let at = start;
  const onDone = () => ++at;
  const out = [];
  for (let i = 0; i < count; i++)
    out.push({ id: i, name: "job", tries: 0, limit: 3, first: true, last: false, next: null, now: () => at, cost: measure(i), onDone });
  return out;
}
const bus = new EventEmitter();
jobs(1, 1);
const all = jobs(+(process.argv[2] ?? 7), 3);
for (const job of all) bus.on("done", job.onDone);
for (const job of all) bus.off("done", all[0].onDone);
console.log(bus.listenerCount("done"), all[1].now(), calls);
