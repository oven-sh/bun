const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at, tools, loud) {
  const pair = [tools.round(at + 0.5), at + 1];
  const mark = loud ? "!" : ".";
  const [a, b] = pair;
  return a + ":" + b + mark;
}
console.log(take(1, kit, true), take(2, kit, false));
