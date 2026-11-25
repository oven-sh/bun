// Declared lists of numbers: elements on both levels, by index and by counter
function weights(values: number[], factor: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(values[k] * factor);
    }
    out.push(values[i]);
  }
  return out;
}
console.log(weights([1, 2, 3], 2).join());
console.log(weights([5, 15, 25], -1).join());
console.log(weights([7, 8, 9], 1).length, weights([1000000, 1, 0], 2).join());
