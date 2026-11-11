type Source = { x: number; y: number };
function byName(o: Source): [string, number][] {
  return [["x", o.x], ["y", o.y]];
}
function both(source: Source): string {
  const listers = [Object.entries, byName];
  const parts: string[] = [];
  for (let i = 0; i < 2; i++) {
    for (const [k, v] of listers[i](source)) parts.push(k + "=" + v);
  }
  return parts.join(" ");
}
let a = "";
for (let round = 0; round < 300; round++) a = both({ x: round, y: 2 });
console.log(a);
