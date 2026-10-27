// Copied from WebKit JSTests/microbenchmarks/date-now.js and date-now-elapsed.js.
// Not a mitata benchmark: run directly with `bun date-now.mjs`.
{
  let sum = 0;
  const t0 = performance.now();
  for (let i = 0; i < 1e6; ++i) sum += Date.now();
  const t1 = performance.now();
  if (sum < 0) throw new Error("bad result");
  console.log("Date.now() x 1e6:".padEnd(28), (t1 - t0).toFixed(2), "ms");
}

{
  let sum = 0;
  const start = Date.now();
  const t0 = performance.now();
  for (let i = 0; i < 1e6; ++i) {
    const diff = Date.now() - start;
    if (diff >= 0 && diff < 1e9) sum += diff;
  }
  const t1 = performance.now();
  if (sum < 0) throw new Error("bad result");
  console.log("Date.now() elapsed x 1e6:".padEnd(28), (t1 - t0).toFixed(2), "ms");
}
