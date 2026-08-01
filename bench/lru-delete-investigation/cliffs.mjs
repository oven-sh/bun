// Find the exact cliffs.
function makeObj(n) {
  const o = {};
  for (let i = 0; i < n; i++) o[`k${i}`] = i;
  return o;
}
function churn(o, N, rounds) {
  const keys = Array.from({ length: N }, (_, i) => `k${i}`);
  const newKeys = Array.from({ length: rounds }, (_, i) => `key${i}`);
  let tail = 0;
  const t0 = performance.now();
  for (let i = 0; i < rounds; i++) {
    delete o[keys[tail]];
    const nk = newKeys[i];
    o[nk] = tail;
    keys[tail] = nk;
    tail = (tail + 1) % N;
  }
  return performance.now() - t0;
}

console.log(`runtime: ${typeof Bun !== 'undefined' ? 'bun' : 'node'}`);
console.log();
console.log("N\tms(churn=2100)");
for (const N of [64, 100, 120, 127, 128, 129, 150, 200, 250, 256, 500, 512, 1000, 1024, 2000, 2048, 3000, 3072, 3500, 3900, 4000, 4095, 4096, 4097, 4100, 5000, 8000, 8192, 16384]) {
  // fresh obj each time to avoid history effects
  const o = makeObj(N);
  // warmup
  churn(makeObj(N), N, 100);
  const t = churn(o, N, 2100);
  console.log(`${N}\t${t.toFixed(3)}`);
}
