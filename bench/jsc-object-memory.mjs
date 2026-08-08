// Comprehensive memory benchmark for JSC object sizes
const gc = globalThis.gc || (() => {});

function bench(name, N, fn) {
  const arr = new Array(N);
  gc(); gc();
  const r0 = process.memoryUsage().rss;
  const h0 = (typeof Bun !== 'undefined') ? require('bun:jsc').heapStats().heapSize : process.memoryUsage().heapUsed;
  for (let i = 0; i < N; i++) arr[i] = fn(i);
  gc(); gc();
  const r1 = process.memoryUsage().rss;
  const h1 = (typeof Bun !== 'undefined') ? require('bun:jsc').heapStats().heapSize : process.memoryUsage().heapUsed;
  // keep arr alive
  if (arr.length !== N) throw new Error();
  console.log(
    name.padEnd(24),
    "rss/obj:", ((r1 - r0) / N).toFixed(1).padStart(6),
    "  heap/obj:", ((h1 - h0) / N).toFixed(1).padStart(6)
  );
  return arr;
}

const N = 1_000_000;

bench("{}", N, () => ({}));
bench("{a}", N, i => ({ a: i }));
bench("{a,b}", N, i => ({ a: i, b: i }));
bench("{a,b,c} analyzer-visible", N, i => { const o = {}; o.a=i; o.b=i; o.c=i; return o; });
bench("{a..f} (6)", N, i => ({ a: i, b: i, c: i, d: i, e: i, f: i }));
bench("{a..g} (7)", N, i => ({ a: i, b: i, c: i, d: i, e: i, f: i, g: i }));
bench("[]", N, () => []);
bench("[1]", N, i => [i]);
bench("[1..5]", N, i => [i, i, i, i, i]);
bench("new Array()", N, () => new Array());
bench("Object.create(null)", N, () => Object.create(null));

// Perf check: push into empty array (the thing change 1b might slow down)
{
  gc();
  const t0 = performance.now();
  const arrs = new Array(100_000);
  for (let j = 0; j < 100_000; j++) {
    const a = [];
    for (let k = 0; k < 5; k++) a.push(k);
    arrs[j] = a;
  }
  const t1 = performance.now();
  console.log("\nperf: 100k x ([] + 5 pushes):", (t1 - t0).toFixed(1), "ms");
  if (arrs.length !== 100_000) throw 0;
}

// Perf check: {} then add 3 props (the thing change 1a might slow down)
{
  gc();
  function helper(o, i) { o.x = i; o.y = i; o.z = i; }
  const t0 = performance.now();
  const objs = new Array(100_000);
  for (let j = 0; j < 100_000; j++) {
    const o = {};
    helper(o, j);
    objs[j] = o;
  }
  const t1 = performance.now();
  console.log("perf: 100k x ({} + helper 3 props):", (t1 - t0).toFixed(1), "ms");
  if (objs.length !== 100_000) throw 0;
}
