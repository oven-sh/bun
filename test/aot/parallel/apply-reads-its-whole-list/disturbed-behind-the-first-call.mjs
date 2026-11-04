let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function run() {
  const list = [1, 2];
  tick.apply(null, list);
  Object.defineProperty(list, 0, descriptor);
  tick.apply(null, list);
  tick.apply(null, list);
}
for (let i = 0; i < 300; i++) run();
console.log(calls, reads);
