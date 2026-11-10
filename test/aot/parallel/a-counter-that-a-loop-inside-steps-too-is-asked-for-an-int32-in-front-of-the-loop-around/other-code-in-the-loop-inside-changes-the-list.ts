// STATISTIC: NestedLoopCounterGuardsHoisted >= 1
const rounds = +process.argv[2]! || 3;
function swap(arr: number[], i: number, j: number): void { const kept = arr[i]!; arr[i] = arr[j]!; arr[j] = kept; }
function part(arr: number[], left: number, right: number, t: any): number {
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
const first: number[] = JSON.parse("[" + Array.from({ length: 32 }, (_, i) => (i * 13 % 32) + 0.5).join() + "]");
const ends: number[] = JSON.parse("[0,31]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) {
  for (const way of [0, 1, 2, 3]) {
    const copy = first.slice();
    let asked = 0;
    const t = way === 0 ? 15.5 : {
      valueOf() {
        asked++;
        if (way === 1 && asked === 5) copy.length = 20;
        if (way === 2 && asked === 7) (copy as any)[9] = "12";
        if (way === 3 && asked === 4) copy.push(1.25, 99.5);
        return 15.5;
      },
    };
    out.push(part(copy, ends[0]!, ends[1]!, t) + ":" + asked + ":" + copy.length + ":" + copy.map(String).join("").length);
  }
}
console.log(out.join(" "));
