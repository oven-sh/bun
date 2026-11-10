// STATISTIC: QuietLoopsBoughtForListsFoundFromInFront >= 1
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
function sum(rows, height, width) {
  let s = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) s = s + rows[y][x];
  return s;
}
const numbers = grid(6, 4, 0);
numbers[1] = [0.5, 1.5, 2.5, 3.5];
numbers[2] = [1, "two", 3, 4];
numbers[3] = [1, , 3, 4];
numbers[4] = [1, 2];
const said = [];
for (let round = 0; round < rounds; round++) {
  try { said.push(String(sum(numbers, 6, 4))); } catch (error) { said.push(error.constructor.name); }
}
console.log(said.join(" "));
