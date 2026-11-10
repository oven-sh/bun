// STATISTIC: LoopsRevisitedWithoutCounterSpeculation >= 1
const rounds = +process.argv[2]! || 3;
function up(list: any, i: any, t: any): any { while (list[i] < t) i++; return i; }
const starts: number[] = JSON.parse("[0,1]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) {
  for (const way of [0, 1, 2, 3, 4]) {
    const list: any[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]");
    let asked = 0;
    const t = way === 0 ? 6 : {
      valueOf() {
        asked++;
        if (way === 1 && asked === 3) list.length = 4;
        if (way === 2 && asked === 3) list[4] = "9";
        if (way === 3 && asked === 3) list.push(0.25, 0.75);
        if (way === 4 && asked === 3) Object.defineProperty(list, 5, { get() { asked += 100; return 99; } });
        return 6;
      },
    };
    out.push(up(list, starts[r & 1], t) + ":" + asked + ":" + list.length);
  }
}
console.log(out.join(" "));
