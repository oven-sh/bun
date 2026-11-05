// Tells each call of an idiom's bench() how many iterations to run: a hundred short calls to warm up, then the long one that
// is measured. Two runs that differ only in AOT_PERF_TURNS do the same work up to the long call, so the difference between
// them is the cost of the long call. The programs without type annotations import this module too: it is the only typed
// function that they call, 101 times per run.
const plan: number[] = new Array(100).fill(Number(process.env.AOT_PERF_WARM_UP_TURNS ?? 5000));
plan.push(Number(process.env.AOT_PERF_TURNS));

export function nextTurns(_check: number): number {
  return plan.shift() ?? 0;
}
