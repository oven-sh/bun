// Under: --aot-harden=proof-checks: a row that begins with a literal and that a loop inside fills is the row of the next turn, also where a turn returns it: the build stopped
// Flags: --aot-harden=proof-checks
function tariff(from: string, to: string) {
  const n = to.length, m = from.length;
  let last: number[] = [0, 2, 4, 6];
  for (let i = 1; i <= m; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= n; ++j) row.push(last[j - 1]!);
    last = row;
    if (i > 2) return last;
  }
  return last[0];
}
function detours(from: string, to: string) {
  const n = to.length, m = from.length;
  let last: number[] = Array.from({ length: n + 1 }, (_, j) => j * 2);
  for (let i = 1; i <= m; i++) {
    const row: number[] = [-i];
    for (let j = 1; j <= n; ++j) row.push(from[i - 1] !== to[j - 1] ? last[j - 1]! : 1 + last[j]!);
    last = row;
    if (i > 30) return last;
  }
  return last[0];
}
function halves(from: string, to: string) {
  const n = to.length, m = from.length;
  let last: number[] = [0, 2, 4, 6];
  for (let i = 1; i <= m; i++) {
    const row: number[] = [i, 1];
    for (let j = 1; j <= n; ++j) row.push(last[j - 1]! + 0.5);
    last = row;
    if (i > 2) return row;
  }
  return last[1];
}
const held: any = JSON.parse("{}");
held["tariff" + process.pid] = tariff;
held["detours" + process.pid] = detours;
held["halves" + process.pid] = halves;
for (const [from, to] of [["ccx", ""], ["2bx2wc2a1wb2,zya", "ab"], ["2bx2wc2a1wb2,zya2bx2wc2a1wb2,zya2bx2wc2a1wb2,zya", "ab"], ["ccccc", "cbc"], ["", "abc"]] as const) {
  console.log(String(tariff(from, to)), String(detours(from, to)), String(halves(from, to)));
  console.log(String(held["tariff" + process.pid](from, to)), String(held["detours" + process.pid](from, to)), String(held["halves" + process.pid](from, to)));
}
