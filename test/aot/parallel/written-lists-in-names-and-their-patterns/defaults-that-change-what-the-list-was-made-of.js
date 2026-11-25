const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
let north = 1, south = 2;
function turnModule(tools) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  [north, south] = [south, tools.round(north + 0.5)];
  return north + ":" + south + ":" + work;
}
function turnCaptured(tools, at) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let east = at, west = at + 1;
  const bump = () => { east += 10; west += 100; return -1; };
  const [a = bump(), b, c = bump(), d] = [undefined, east, undefined, tools.round(west + 0.5)];
  [east, west] = [west, east];
  return [a, b, c, d, east, west, work].join(":");
}
let p = "", q = "";
for (let round = 0; round < 300; round++) { p = turnModule(kit); q = turnCaptured(kit, round % 7); }
console.log(p, q);
