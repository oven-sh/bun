// STATISTIC: ArrayBoundsChecksHoisted >= 2
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
  let s = 0;
  for (let y = 0; y < 10; y++) for (let x = 1; x < 11; x++) s = s + rows[y][x + 1] - rows[y][x - 1];
  return s;
}
const numbers = grid(10, 12, 0.5);
const said = [];
for (let round = 0; round < rounds; round++) said.push(String(slope(numbers)));
console.log(said.join(" "));
