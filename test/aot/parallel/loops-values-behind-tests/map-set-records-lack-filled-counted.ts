// The map and the set of a record are filled by counted loops, behind the test of the kind inside the turn. Some records have neither.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; index: Map<number, number>; members: Set<number> } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  return { kind: 0, index: new Map([[i, 1]]), members: new Set([i]) };
}
function fill(r: Result, n: number): number {
  let skipped = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) r.index.set(j, j * 2);
    else skipped++;
  }
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) r.members.add(j * 3);
    else skipped++;
  }
  return r.kind === 0 ? r.index.size * 100 + r.members.size : skipped + r.name.length;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, fill(make(i), 40));
console.log(total);
