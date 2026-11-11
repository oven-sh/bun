// STATISTIC: NestedLoopCounterGuardsHoisted >= 1
const rounds = +process.argv[2]! || 3;
const marks: number[] = JSON.parse("[1,1,1,0,1,1,0,1]");
function climb(list: number[], from: number, until: number): number {
  let i = from, seen = 0;
  while (i < until) {
    seen += list[i & 7]!;
    i++;
    while (list[i & 7]! > 0) i++;
  }
  return i * 8 + (seen & 7);
}
const starts: number[] = JSON.parse("[0,2147483640,2147483646,-2147483650,4294967290,9007199254740900,0.25]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (const s of starts) out.push(String(climb(marks, s + (r & 1), s + 12)));
console.log(out.join(" "));
