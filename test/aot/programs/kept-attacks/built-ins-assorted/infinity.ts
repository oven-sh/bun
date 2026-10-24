// Built ins assorted, one probe of many. It prints what plain Bun prints.
function least(values: number[]): number {
  let best = Infinity;
  for (const value of values) if (value < best) best = value;
  return best;
}
function orNaN(value: number): number {
  return value > 0 ? value : NaN;
}
console.log(least([3, 1, 2]), orNaN(-1), Number.NaN, undefined);
