let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function* steps() {
  const list = [1, 2, 3];
  const given = yield list;
  tick.apply(null, list);
  take.apply(null, list);
  return given;
}
async function waits(disturb) {
  const list = [1, 2, 3];
  await disturb(list);
  tick.apply(null, list);
  take.apply(null, list);
}
for (let i = 0; i < 300; i++) {
  const running = steps();
  Object.defineProperty(running.next().value, 1, descriptor);
  running.next(1);
}
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) await waits(async (list) => { Object.defineProperty(list, 1, descriptor); });
console.log(calls, reads, sum);
