// STATISTIC: InvariantArrayLoopsVersioned >= 1
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
function dot(one, other, height, width) {
  let s = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) s = s + one[y][x] * other[y][x];
  return s;
}
const here = grid(6, 8, 0), there = grid(6, 8, 0.25);
const said = [];
for (let round = 0; round < rounds; round++) {
  try { said.push(String(dot(here, there, 6, 8))); } catch (error) { said.push(error.constructor.name); }
}
console.log(said.join(" "));
