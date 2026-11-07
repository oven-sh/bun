// STATISTIC: SerializersCreated = 1
// STATISTIC: InlineFramesEmitted = 0
const word = process.argv[2] ?? "word";
const note = { role: word + "-role", text: word + "-text" };
function four(o) {
  let sum = 0;
  sum ^= JSON.stringify(o).length + 0;
  sum ^= JSON.stringify(o).length + 1;
  sum ^= JSON.stringify(o).length + 2;
  sum ^= JSON.stringify(o).length + 3;
  return sum;
}
function drive(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum ^= four(note) + i;
  return sum;
}
const rows = new Map([["drive", drive]]);
console.log(rows.get(process.argv[3] ?? "drive")(30000), JSON.stringify(note));
