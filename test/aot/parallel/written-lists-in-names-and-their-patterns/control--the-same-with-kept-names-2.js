const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
let north = 1, south = 2;
function turnModule(tools) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const first = south, second = tools.round(north + 0.5);
  north = first; south = second;
  return north + ":" + south + ":" + work;
}
function turnCaptured(tools, at) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let east = at, west = at + 1;
  const bump = () => { east += 10; west += 100; return -1; };
  const second = east, fourth = tools.round(west + 0.5);
  const a = bump(), b = second, c = bump(), d = fourth;
  const kept = east; east = west; west = kept;
  return [a, b, c, d, east, west, work].join(":");
}
let p = "", q = "";
for (let round = 0; round < 300; round++) { p = turnModule(kit); q = turnCaptured(kit, round % 7); }
console.log(p, q);
