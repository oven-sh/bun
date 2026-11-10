// STATISTIC: ListsTakenUnderCountersAskedInFrontOfLoops >= 1
const rounds = +process.argv[2]! || 3;
function sum(list: any, i: any, end: number): any { let s = 0; while (i < end) { const x = list[i]; s += x === undefined ? 1 : x; i++; } return s + ":" + i; }
function upTo(list: any, i: any, t: number, end: number): any { while (!(list[i] >= t) && i < end) i++; return i; }
const list: number[] = JSON.parse("[0.5,1.5,2.5,3.5]");
const ends: number[] = JSON.parse("[2147483640,2147483655,0,6,-3,2,4294967290,4294967300]");
for (let r = 0; r < rounds; r++) {
  console.log(sum(list, ends[0], ends[1]!));
  console.log(sum(list, ends[2], ends[3]!));
  console.log(sum(list, ends[4], ends[5]!));
  console.log(sum(list, ends[6], ends[7]!));
  console.log(upTo(list, ends[0], 2, ends[1]!), upTo(list, ends[2], 2, ends[3]!));
}
