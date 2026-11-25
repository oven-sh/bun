// A row that begins with a literal and that a loop inside fills is the row of the next turn, also where a turn returns it.
const whole: number[] = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]");
const half: number[] = JSON.parse("[0.5,1.5,2,3,4,5.5,6,7,8,9,10,11,12,13,14,15,16,17]");
function ledger(from: string, to: string, first: number[]) {
  const n = to.length, m = from.length;
  let last: number[] = first;
  for (let i = 1; i <= m; ++i) {
    const row: number[] = [i, i];
    for (let j = 1; j <= n; j++) row.push(last[j]!);
    last = row;
    if (i > 2 && row.length > 4) return last;
  }
  return last[n];
}
function fares(from: string, to: string, first: number[]) {
  const n = to.length, m = from.length;
  let last: number[] = first;
  for (let i = 1; i <= m; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= n; ++j) row.push(from[i - 1] === to[j - 1] ? last[j - 1]! : 1 + last[j]!);
    last = row;
    if (i > 3) return last;
  }
  return last[0];
}
const held: any = JSON.parse("{}");
held["ledger" + process.pid] = ledger;
held["fares" + process.pid] = fares;
for (const [from, to] of [["ccx", ""], ["abc", "abcabcab"], ["winter", "summer"], ["2bx2wc2a1wb2,zya", "ab"]] as const) {
  console.log(JSON.stringify(ledger(from, to, whole)), JSON.stringify(held["ledger" + process.pid](from, to, half)));
  console.log(JSON.stringify(fares(from, to, whole)), JSON.stringify(held["fares" + process.pid](from, to, half)));
}
