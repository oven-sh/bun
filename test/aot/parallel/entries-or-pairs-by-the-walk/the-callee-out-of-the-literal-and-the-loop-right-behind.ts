type Source = { x: number; y: number };
function byName(o: Source): [string, number][] {
  return [["x", o.x], ["y", o.y]];
}
function tally(plain: boolean, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const kit = plain ? { list: Object.entries } : { list: byName };
  const parts: string[] = [];
  for (const [k, v] of kit.list(source)) parts.push(k + "=" + v);
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally(true, { x: round, y: 2 });
  b = tally(false, { x: round, y: 2 });
}
console.log(a);
console.log(b);
