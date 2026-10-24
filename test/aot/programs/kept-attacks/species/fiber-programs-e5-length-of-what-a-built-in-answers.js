// Species: fiber programs  length of what a built in answers. It prints what plain Bun prints.
const table = { a: 1, b: 2, c: 3 };
const words = "one,two,three,four";
const list = [1, 2, 3, 4, 5];
function lengths(round) {
  const keys = Object.keys(table), parts = words.split(","), mapped = list.map(x => x + round), kept = list.filter(x => x > 2), cut = list.slice(1), joined = list.concat(cut);
  return keys.length + parts.length + mapped.length + kept.length + cut.length + joined.length;
}
let sum = 0;
for (let round = 0; round < 100000; round++) sum += lengths(round);
console.log(sum);
