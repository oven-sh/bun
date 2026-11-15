const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at, tools, quit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const first = tools.round(at + 0.5);
  const pair = [first, at + 1];
  if (quit) return "out" + work;
  const [a, b] = pair;
  return a + ":" + b + ":" + work;
}
let x = "", y = "";
for (let round = 0; round < 300; round++) {
  x = take(round, kit, false);
  y = take(round, kit, true);
}
console.log(x, y);
