// Characterize: what scales, what doesn't.
// Run under bun and node for side-by-side.

function timeIt(label, iters, fn) {
  // warmup
  for (let i = 0; i < 3; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const t1 = performance.now();
  const perIter = (t1 - t0) / iters;
  console.log(`${label.padEnd(50)} ${perIter.toFixed(3).padStart(10)} ms/iter`);
  return perIter;
}

function makeObj(n, proto = Object.prototype) {
  const o = Object.create(proto);
  for (let i = 0; i < n; i++) o[`k${i}`] = i;
  return o;
}

console.log(`runtime: ${typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version}`);
console.log();

// 1) Scaling with object size N: delete+add CHURN=2100 times
console.log("--- scaling with N (delete+add, churn=2100) ---");
for (const N of [10, 50, 100, 250, 500, 1000, 2000, 4000]) {
  const o = makeObj(N);
  const keys = Array.from({ length: N }, (_, i) => `k${i}`);
  const newKeys = Array.from({ length: 2100 }, (_, i) => `key${i}`);
  let tail = 0;
  timeIt(`N=${N}`, 5, () => {
    for (let i = 0; i < 2100; i++) {
      delete o[keys[tail]];
      const nk = newKeys[i];
      o[nk] = tail;
      keys[tail] = nk;
      tail = (tail + 1) % N;
    }
  });
}

console.log();
console.log("--- which op is slow (N=1000, 2100 ops each) ---");
{
  const N = 1000;
  // delete only (delete+re-add same key)
  {
    const o = makeObj(N);
    timeIt("delete then re-add SAME key", 5, () => {
      for (let i = 0; i < 2100; i++) {
        const k = `k${i % N}`;
        delete o[k];
        o[k] = i;
      }
    });
  }
  // delete only, no re-add (object shrinks then refill)
  {
    timeIt("delete all N, then add all N back", 5, () => {
      const o = makeObj(N);
      for (let i = 0; i < N; i++) delete o[`k${i}`];
      for (let i = 0; i < N; i++) o[`k${i}`] = i;
    });
  }
  // pure delete loop (delete nonexistent after first pass)
  {
    const o = makeObj(N);
    timeIt("delete existing (1000 deletes, obj shrinks to 0)", 5, () => {
      const o2 = makeObj(N);
      for (let i = 0; i < N; i++) delete o2[`k${i}`];
    });
  }
  // pure add loop on dictionary-mode obj (after one delete)
  {
    const o = makeObj(N);
    delete o[`k0`]; // force dictionary
    timeIt("add 2100 new keys to dict-mode obj (starts N=1000)", 5, () => {
      const o2 = makeObj(N);
      delete o2.k0;
      for (let i = 0; i < 2100; i++) o2[`key${i}`] = i;
    });
  }
  // add new key then delete it (size stays constant)
  {
    const o = makeObj(N);
    timeIt("add NEW key then delete it (size constant)", 5, () => {
      for (let i = 0; i < 2100; i++) {
        const k = `key${i}`;
        o[k] = i;
        delete o[k];
      }
    });
  }
  // delete old, add new (mnemonist pattern)
  {
    const o = makeObj(N);
    const keys = Array.from({ length: N }, (_, i) => `k${i}`);
    const newKeys = Array.from({ length: 2100 }, (_, i) => `key${i}`);
    let tail = 0;
    timeIt("delete OLD key, add NEW key (mnemonist)", 5, () => {
      for (let i = 0; i < 2100; i++) {
        delete o[keys[tail]];
        const nk = newKeys[i];
        o[nk] = tail;
        keys[tail] = nk;
        tail = (tail + 1) % N;
      }
    });
  }
}

console.log();
console.log("--- Object.create(null) vs {} (N=1000) ---");
for (const [label, proto] of [["{}", Object.prototype], ["Object.create(null)", null]]) {
  const o = makeObj(1000, proto);
  const keys = Array.from({ length: 1000 }, (_, i) => `k${i}`);
  const newKeys = Array.from({ length: 2100 }, (_, i) => `key${i}`);
  let tail = 0;
  timeIt(label, 5, () => {
    for (let i = 0; i < 2100; i++) {
      delete o[keys[tail]];
      const nk = newKeys[i];
      o[nk] = tail;
      keys[tail] = nk;
      tail = (tail + 1) % 1000;
    }
  });
}
