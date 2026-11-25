type Source = { x: number; y: number };
function tally(source: Source): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(source)) parts.push(k + "=" + v);
  return parts.join(" ") + " " + work;
}
let a = "";
for (let round = 0; round < 300; round++) a = tally({ x: round, y: 2 });
console.log(a);
