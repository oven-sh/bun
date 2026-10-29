// A function stores what another function answers into a variable of the module. That function calls itself without end, so the store is never reached and the catch clause sets the variable.
let kept: number = 0;
function recurse(start: number): number {
  const deep = (depth: number): number => 1 + deep(depth + 1);
  return deep(start);
}
function keep(start: number): number {
  try {
    kept = recurse(start + 1);
  } catch {
    kept = -3;
  }
  return kept;
}
console.log([1].map(value => keep(value))[0]);
