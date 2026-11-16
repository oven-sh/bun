type Source = { x: number; y: number };
function byName(o: Source): [string, number][] {
  return [["x", o.x], ["y", o.y]];
}
class Kit {
  off = false;
  list: (o: Source) => [string, number][] = Object.entries;
}
const kits: Kit[] = [new Kit(), { list: byName, off: false }, new Kit()];
function tally(at: number, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const kit = kits[at];
  const parts: string[] = [];
  for (const [k, v] of kit.list(source)) parts.push(k + "=" + v);
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally(0, { x: round, y: 2 });
  b = tally(1, { x: round, y: 2 });
}
console.log(a);
console.log(b);
