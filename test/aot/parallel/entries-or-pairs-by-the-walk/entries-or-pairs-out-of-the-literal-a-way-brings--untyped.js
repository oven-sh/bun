function byName(o) {
  return [["x", o.x], ["y", o.y]];
}
function tally(plain, loud, source) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const kit = plain ? { list: Object.entries } : { list: byName };
  const es = kit.list(source);
  const mark = loud ? "!" : ".";
  const parts = [];
  for (const [k, v] of es) parts.push(k + "=" + v + mark);
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally(true, (round & 1) === 1, { x: round, y: 2 });
  b = tally(false, (round & 1) === 1, { x: round, y: 2 });
}
console.log(a);
console.log(b);
