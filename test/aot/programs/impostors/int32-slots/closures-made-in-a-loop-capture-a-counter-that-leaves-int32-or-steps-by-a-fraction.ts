// `for (let i = from; i < to; i += step)` makes one closure per round, and each stores the counter of its round into a number field.
// The calls in sight count in small integers. Hidden callers start just below 2 ** 31, step by a half, count in steps of 2 ** 30, or hand over addends whose sum leaves int32.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Mark { at = 0; }
function schedule(marks: Mark[], from: number, to: number, step: number) {
  const jobs: (() => void)[] = [];
  let index = 0;
  for (let i = from; i < to; i += step) {
    const mark = marks[index++];
    jobs.push(() => { mark.at = i; });
  }
  return jobs;
}
class Sum { at = 0; }
function scheduleSums(sums: Sum[], base: number, by: number) {
  const jobs: (() => () => void)[] = [];
  for (let k = 0; k < sums.length; k++) {
    const total = base + by + k;
    const sum = sums[k];
    jobs.push(() => () => { sum.at = total - 1; });
  }
  return jobs.map(job => job());
}
function marks(count: number) {
  const list: Mark[] = [];
  for (let i = 0; i < count; i++) {
    const mark = new Mark();
    handOver(mark);
    list.push(mark);
  }
  return list;
}
function sums(count: number) {
  const list: Sum[] = [];
  for (let i = 0; i < count; i++) {
    const sum = new Sum();
    handOver(sum);
    list.push(sum);
  }
  return list;
}
function run(jobs: (() => void)[], list: { at: number }[]) {
  for (const job of jobs) job();
  return list.map(mark => exact(mark.at)).join(" ") + " | " + list.map(mark => exact(mark.at + 1)).join(" ") + " | " + JSON.stringify(list);
}
let sum = 0;
for (let round = 0; round < 500; round++) {
  const list = marks(4);
  for (const job of schedule(list, round & 7, (round & 7) + 4, 1)) job();
  const others = sums(4);
  for (const job of scheduleSums(others, round & 15, 2)) job();
  sum += list[0].at + list[3].at + others[3].at;
}
console.log("warm", sum);
const cases: [string, number, number, number][] = JSON.parse('[["over the top",2147483645,2147483650,1],["by halves",0,2.5,0.5],["big steps",0,4294967296,1073741824],["below the bottom",-2147483650,-2147483641,2]]'.split("").join(""));
for (const [label, from, to, step] of cases) {
  const list = marks(5);
  console.log(label + ":", run(schedule.apply(undefined, [list, from, to, step]), list));
}
const bases: [string, number, number][] = JSON.parse('[["two large halves",1073741824,1073741823],["a fraction",1,0.25],["far below",-2147483647,-3],["not a number",1,null]]'.split("").join(""));
for (const [label, base, by] of bases) {
  const targets = sums(4);
  console.log(label + ":", run(Reflect.apply(scheduleSums, undefined, [targets, base, by ?? NaN]), targets));
}
