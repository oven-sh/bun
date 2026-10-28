class Tally {
  hits = 0;
  a = 1;
  b = 2;
}
const tallies: Tally[] = [];
for (let index = 0; index < 8; index++) tallies.push(new Tally());
function add(list: Tally[], turns: number, by: number) {
  for (let turn = 0; turn < turns; turn++) list[turn & 7]!.hits += by;
}
const [loop = "past 2 ** 31", turns = "5000"] = process.argv.slice(2);
add(tallies, Number(turns) | 0, loop === "past 2 ** 31" ? 1 << 24 : 1);
console.log(tallies[0]!.hits > 0, tallies[0]!.a + tallies[0]!.b);
