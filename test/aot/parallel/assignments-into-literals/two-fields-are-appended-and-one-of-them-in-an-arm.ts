// STATISTIC: ObjectAssignCallsExpanded >= 1
interface Options { depth: number; width: number }
let work = 0;
function only(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, given);
}
function fresh(): Options { return { depth: 1, width: 2 }; }
function show(o: any): string {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.keys(o).join() + "|" + o.depth + "|" + o.width + "|" + o.extra + "|" + o.more;
}
function marked(both: boolean): Options {
  const made: any = fresh();
  if (both) made.more = 7;
  made.extra = 6;
  return made;
}
const flags: boolean[] = [JSON.parse("true"), JSON.parse("false")];
let sum = 0;
for (let i = 0; i < 300; i++) sum += only(fresh()).depth;
console.log(sum, show(only(fresh())));
for (const flag of flags) console.log(show(only(marked(flag))));
