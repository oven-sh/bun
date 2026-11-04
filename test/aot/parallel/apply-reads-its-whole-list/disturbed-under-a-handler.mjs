let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function fail() { throw new Error("stop"); }
function none() {
  const list = [1, 2, 3];
  try { Object.defineProperty(list, 1, descriptor); fail(); } catch { tick.apply(null, list); } finally { tick.apply(null, list); }
}
function one() {
  const list = [1, 2, 3];
  try { Object.defineProperty(list, 1, descriptor); fail(); } catch { take.apply(null, list); } finally { take.apply(null, list); }
}
for (let i = 0; i < 300; i++) none();
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) one();
console.log(calls, reads, sum);
