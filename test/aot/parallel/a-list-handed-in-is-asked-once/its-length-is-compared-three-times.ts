// `parts.length === 0`, `=== 1`, `=== 2` stand in three blocks of their own, outside of loops: no block alone has two operations that lean on the list. What stands behind each branch leans on it again,
// so the list is asked for once, at the first read, and its length is read once.
// STATISTIC: ArrayParameterChecksSpanningBranches = 1
type Part = { weight: number };
function gather(parts: readonly Part[], bonus: number): number {
  if (parts.length === 0) return bonus;
  if (parts.length === 1) return parts[0].weight;
  if (parts.length === 2) return parts[0].weight + parts[1].weight * bonus;
  let sum = 0;
  for (const part of parts) sum += part.weight;
  return sum;
}
const made: Part[][] = JSON.parse('[[],[{"weight":3}],[{"weight":3},{"weight":4}],[{"weight":1},{"weight":2},{"weight":3}]]');
console.log(made.map(parts => gather(parts, 5)).join());
