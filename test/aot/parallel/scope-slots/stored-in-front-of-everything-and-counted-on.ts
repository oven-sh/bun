// What the rows are for: every binding is stored in front of the first point at which anything can look.
function make(start: number) {
  var count = 0;
  const limit = 10;
  let total = start;
  const names: string[] = [];
  return { bump, report };
  function bump(n: number): boolean { count++; total += n; names.push("n" + n); return total > limit; }
  function report(): string { return [count, limit, total, names.join("+")].join(); }
}
for (let round = 0; round < 3; round++) { const it = make(round); console.log(it.bump(4), it.bump(7), it.report()); }
