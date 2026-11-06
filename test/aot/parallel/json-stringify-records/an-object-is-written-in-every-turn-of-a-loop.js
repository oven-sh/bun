// COUNT: branches <= 30100
const word = process.argv[2] ?? "word";
const note = { role: word + "-role", text: word + "-text" };
function once(o) {
  return JSON.stringify(o).length;
}
function drive(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum ^= once(note) + i;
  return sum;
}
const rows = new Map([["drive", drive]]);
console.log(rows.get(process.argv[3] ?? "drive")(30000));
