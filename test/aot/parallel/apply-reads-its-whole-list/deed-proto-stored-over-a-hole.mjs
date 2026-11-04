let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
const above = Object.create(Array.prototype, { 1: descriptor });
function run() {
  const list = [1, , 2];
  list.__proto__ = above;
  tick.apply(null, list);
}
for (let i = 0; i < 300; i++) run();
console.log(calls, reads, above.length);
