const unseen = (x: unknown): any => [x][JSON.parse("0")];
type Source = { x: number; y: number };
const kit = { seal: Object.freeze };
unseen(kit);
function tally(tools: { seal: (s: Source) => Source }, source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(tools.seal(source))) parts.push(k + "=" + v);
  return parts.join(" ") + " " + work;
}
let a = "";
for (let round = 0; round < 300; round++) a = tally(kit, { x: round, y: 2 });
console.log(a);
