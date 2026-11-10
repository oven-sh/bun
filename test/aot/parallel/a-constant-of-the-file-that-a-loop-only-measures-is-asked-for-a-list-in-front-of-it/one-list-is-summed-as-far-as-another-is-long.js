const rounds = Number(process.argv[2] ?? 3);
const rows = JSON.parse('[{"a":1},{"a":2},{"a":3},{"a":4},{"a":5},{"a":6}]');
const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5]");
function tally(start) {
  let total = start & 3;
  for (let i = 0; i < rows.length; i++) total += weights[i];
  return total;
}
const byName = { tally };
const name = JSON.parse('"tally"');
let all = 0;
for (let round = 0; round < rounds; round++) all = (all * 31 + byName[name](round)) % 1000003;
console.log(all.toFixed(3));
