// STATISTIC: CountersThatLoopsInsideStepAskedInFrontOfLoops >= 1
const rounds = +process.argv[2]! || 3;
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);
function swap(arr: number[], i: number, j: number): void { const kept = arr[i]!; arr[i] = arr[j]!; arr[j] = kept; }
function part(arr: number[], left: number, right: number, t: number): number {
  let i = left, j = right;
  while (i < j) {
    swap(arr, i, j);
    i++;
    j--;
    while (arr[i]! < t) i++;
    while (arr[j]! > t) j--;
  }
  return j;
}
const first: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, i) => (i * 29 % 48) + 0.5).join() + "]");
const ends: number[] = JSON.parse("[0,47,3,40,0.5,20.5,-1,12,-0,47,47,0,5,5,4294967290,4294967299,2147483646,2147483649,-2147483649,-2147483645,1e300,2]");
ends.push(NaN, 7, 7, NaN, Infinity, 3, 3, -Infinity);
const out: string[] = [];
for (let r = 0; r < rounds; r++) {
  for (let e = 0; e + 1 < ends.length; e += 2) {
    const copy = first.slice();
    const at = part(copy, ends[e]!, ends[e + 1]!, 20.5 + (r & 7));
    let sum = 0;
    for (const key of Object.keys(copy)) sum = (sum * 31 + (copy as any)[key] * 2 + key.length) % 1000003;
    out.push(say(at) + ":" + say(sum) + ":" + copy.length);
  }
}
console.log(out.join(" "));
