const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(limit, tools) {
  for (let i = 0; ; i++) {
    const pair = [tools.round(i + 0.5), i * 2];
    if (i >= limit) {
      const [a, b] = pair;
      return a + ":" + b;
    }
  }
}
let last = "";
for (let round = 0; round < 300; round++) last = take(round & 7, kit);
console.log(last, take(0, kit), take(3, kit));
