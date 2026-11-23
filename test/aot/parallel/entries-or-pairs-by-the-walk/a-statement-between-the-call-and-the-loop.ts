type Source = { x: number; y: number };
function tally(loud: boolean, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const es = Object.entries(source);
  const mark = loud ? "!" : ".";
  const parts: string[] = [];
  for (const [k, v] of es) parts.push(k + "=" + v + mark);
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally(true, { x: round, y: 2 });
  b = tally(false, { x: round, y: 2 });
}
console.log(a);
console.log(b);
