type Source = { x: number; y: number };
function byName(o: Source): [string, number][] {
  return [["x", o.x], ["y", o.y]];
}
function tally(plain: boolean, loud: boolean, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let list: (o: Source) => [string, number][] = Object.entries, marks = { open: work };
  if (!plain) {
    list = byName;
    marks = { open: work + 1 };
  }
  const es = list(source);
  work = (work + marks.open - marks.open) | 0;
  const mark = loud ? "!" : ".";
  const parts: string[] = [];
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
