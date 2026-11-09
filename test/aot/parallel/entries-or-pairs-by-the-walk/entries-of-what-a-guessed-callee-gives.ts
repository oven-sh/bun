const unseen = (x: unknown): any => [x][JSON.parse("0")];
type Source = { x: number; y: number };
const kit = { pick: (s: Source): Source => s };
const other = { pick: (s: Source): Source => ({ x: s.y, y: s.x }) };
unseen(kit);
unseen(other);
function tally(tools: { pick: (s: Source) => Source }, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(tools.pick(source))) parts.push(k + "=" + v);
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally(kit, { x: round, y: 2 });
  b = tally(round === 299 ? other : kit, { x: round, y: 2 });
}
console.log(a);
console.log(b);
