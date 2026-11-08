// The block is walked once for each way that brings the source in sight, the literal with it: its name is bound anew on each way.
// STATISTIC: AssignmentsWrittenOutFieldByField >= 2
type Options = { depth: number; level?: number; quiet?: boolean };
let work = 0;
function settle(verbose: boolean, depth: number): Options {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const extra = verbose ? { level: depth + 1 } : { quiet: depth > 2 };
  const options: Options = { depth };
  Object.assign(options, extra);
  return options;
}
let sum = 0;
for (let i = 0; i < 2000; i++) { const o = settle((i & 1) === 0, i & 7); sum += o.depth + (o.level ?? 0) + (o.quiet ? 1 : 0); }
console.log(sum, JSON.stringify(settle(true, 1)), JSON.stringify(settle(false, 3)));
