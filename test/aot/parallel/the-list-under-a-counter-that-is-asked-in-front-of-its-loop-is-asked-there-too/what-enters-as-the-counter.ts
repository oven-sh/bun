// STATISTIC: ListsTakenUnderCountersAskedInFrontOfLoops >= 1
const rounds = +process.argv[2]! || 3;
function up(list: any, i: any, t: number): any { while (list[i] < t) i++; return i; }
function upTyped(list: number[], i: number, t: number): number { while (list[i]! < t) i++; return i; }
const list: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]");
let asked = 0;
const starts: any[] = [
  0, 1.5, -1, -0, NaN, "0", "2", undefined, null, true, 1n, 2147483647, 4294967296,
  { valueOf() { asked++; return 1; }, toString() { asked += 10; return "1"; } },
  { [Symbol.toPrimitive](hint: string) { asked += 100; return hint === "number" ? 2 : "2"; } },
];
for (let r = 0; r < rounds; r++) {
  const out: string[] = [];
  for (const start of starts) {
    const end = up(list, start, 4);
    out.push(typeof end + ":" + (Object.is(end, -0) ? "-0" : String(end)));
  }
  console.log(out.join(" "));
  console.log(asked);
  console.log([0, 1, 2.5, -3, NaN, 7].map(start => upTyped(list, start, 4)).join(" "));
}
