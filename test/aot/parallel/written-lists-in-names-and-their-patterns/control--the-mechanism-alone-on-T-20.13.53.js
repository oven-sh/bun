const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function spin(turns, tools) {
  let a = 1, b = 2;
  for (let i = 0; i < turns; i++) [a, b] = [b | 0, tools.round(a + 1.5)];
  return a + ":" + b;
}
console.log(spin(300, kit), spin(3, kit));
