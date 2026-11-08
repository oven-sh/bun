type Source = { x: number; y: number };
function byName(o: Source): [string, number][] {
  return [["x", o.x], ["y", o.y]];
}
function firstWanted(wanted: number, source: Source): string {
  const listers = [Object.entries, Object.entries];
  for (let i = 0; i < 2; i++) {
    const list = listers[i];
    const es = list(source);
    if (wanted === i) {
      const parts: string[] = [];
      for (const [k, v] of es) parts.push(k + "=" + v);
      return parts.join(" ");
    }
  }
  return "none";
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = firstWanted(0, { x: round, y: 2 });
  b = firstWanted(1, { x: round, y: 2 });
}
console.log(a);
console.log(b);
