// STATISTIC: CountersThatLoopsInsideStepAskedInFrontOfLoops = 0
const rounds = +process.argv[2]! || 3;
const next: number[] = JSON.parse("[3,0,5,1,9,2,4,8,6,7,11,10]");
function chase(list: number[], from: number, until: number): number {
  let sum = 0;
  for (let i = from; i < until; i++) {
    let k = i;
    while (list[k]! > k) k = list[k]!;
    sum = sum * 3 + k;
  }
  return sum;
}
const ends: number[] = JSON.parse("[0,12,2,9,0.5,4.5,-1,3,11,40]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (let e = 0; e + 1 < ends.length; e += 2) out.push(String(chase(next, ends[e]!, ends[e + 1]!)));
console.log(out.join(" "));
