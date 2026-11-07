const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at, tools) {
  let a = tools.round(at + 0.5), b = at + 1;
  [a, b] = [b, a];
  return a + ":" + b;
}
console.log(take(1, kit), take(2, kit));
