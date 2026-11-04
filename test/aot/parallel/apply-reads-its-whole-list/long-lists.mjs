let calls = 0, reads = 0, caught = "";
function tick() { calls++; }
const descriptor = { get() { reads++; return 7; } };
function run(length) {
  const list = new Array(length).fill(0);
  Object.defineProperty(list, length - 1, descriptor);
  try { tick.apply(null, list); } catch (error) { caught = error.constructor.name; }
}
for (let i = 0; i < 30; i++) run(100);
console.log(calls, reads, caught);
for (let i = 0; i < 30; i++) run(70000);
console.log(calls, reads, caught);
