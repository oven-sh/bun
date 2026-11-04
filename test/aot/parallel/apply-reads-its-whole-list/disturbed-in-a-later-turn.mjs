let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function none() {
  const list = [1, 2, 3];
  for (let i = 0; i < 300; i++) {
    tick.apply(null, list);
    if (i === 99) Object.defineProperty(list, 1, descriptor);
  }
}
function one() {
  const list = [1, 2, 3];
  for (let i = 0; i < 300; i++) {
    take.apply(null, list);
    if (i === 99) Object.defineProperty(list, 1, descriptor);
  }
}
none();
console.log(calls, reads, sum);
one();
console.log(calls, reads, sum);
