// STATISTIC: WrittenBoundsAskedOfListsInFrontOfTypedCopies >= 2
const rounds = Number(process.argv[2] ?? 3);
function grid(height, width, step) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push((x * 7 + y * 5) % 11 + step);
    rows.push(row);
  }
  return rows;
}
function slope(rows) {
  let s = 0, missing = 0;
  for (let y = 0; y < 10; y++) for (let x = 1; x < 11; x++) { const d = rows[y][x + 1] - rows[y][x - 1]; if (d === d) s = s + d; else missing++; }
  return s + "/" + missing;
}
const numbers = grid(10, 12, 0.5);
numbers[2] = numbers[2].slice(0, 11);
numbers[7] = numbers[7].slice(0, 3);
const said = [];
for (let round = 0; round < rounds; round++) said.push(String(slope(numbers)));
console.log(said.join(" "));
