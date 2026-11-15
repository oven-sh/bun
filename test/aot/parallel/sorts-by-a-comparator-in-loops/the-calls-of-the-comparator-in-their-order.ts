const said: string[] = [];
type Row = { rank: number; at: number };
function rows(n: number, kind: number): Row[] {
  const made: Row[] = [];
  for (let i = 0; i < n; i++) made.push({ rank: kind === 0 ? i : kind === 1 ? n - i : kind === 2 ? (i * 29 + 7) % 41 : kind === 3 ? (i >> 2) : kind === 4 ? (i < 10 ? i : n - i) : kind === 5 ? (i * 7919) % 13 : kind === 6 ? (i < 8 ? i : -i) : kind === 7 ? (i < 9 ? i : -i) : kind === 8 ? (i < 8 ? -i : i - 100) : (i < 9 ? -i : i - 100), at: i });
  return made;
}
const sizes = [0, 1, 2, 3, 7, 8, 9, 10, 16, 17, 33, 63, 64, 65, 66, 100, 129, 200];
for (const n of sizes) {
  for (let kind = 0; kind < 10; kind++) {
    let calls = 0, trace = 2166136261;
    const sorted = rows(n, kind).sort((a, b) => { calls++; trace = Math.imul(trace ^ (a.at * 256 + b.at), 16777619) >>> 0; return a.rank - b.rank; });
    let order = 2166136261; for (const row of sorted) order = Math.imul(order ^ row.at, 16777619) >>> 0;
    said.push(n + "/" + kind + " " + calls + " " + trace.toString(16) + " " + order.toString(16));
  }
}
console.log(said.join("\n"));
