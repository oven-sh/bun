// STATISTIC: ObjectAssignCallsExpanded >= 2
interface Options { depth: number; width: number; color: boolean }
const DEFAULTS: Options = { depth: 2, width: 80, color: false };
let work = 0;
function merge(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, DEFAULTS, given);
}
function only(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, given);
}
function fresh(): Options { return { depth: 1, width: 2, color: true }; }
function show(o: any): string {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.keys(o).join() + "|" + o.depth + "|" + o.width + "|" + o.color + "|" + o.extra;
}
function marked(): Options {
  const made: any = fresh();
  made.extra = 6;
  return made;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += merge(fresh()).width + only(fresh()).depth;
console.log(sum);
console.log(show(merge(fresh())), show(only(fresh())));
console.log(show(merge(marked())), show(only(marked())));
