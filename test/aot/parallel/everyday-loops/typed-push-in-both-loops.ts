// The same list of numbers, declared as one
function cells(height: number, value: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    out.push(y);
    for (let x = 0; x < 3; x++) {
      out.push(x * value);
    }
    out.push(out.length);
  }
  return out;
}
console.log(cells(3, 2).join());
console.log(cells(2, 0.25).join());
console.log(cells(0, 1).length, cells(4, -2147483648).join());
