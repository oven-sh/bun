interface Options { depth: number; width: number }
interface Marked extends Options { extra: number }
let work = 0;
function only(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, given);
}
function fresh(): Options { return { depth: 1, width: 2 }; }
function show(o: any): string {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.keys(o).join() + "|" + o.depth + "|" + o.width + "|" + o.extra;
}
function marked(): Marked {
  const made = fresh() as Marked;
  made.extra = 6;
  return made;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += only(fresh()).depth + only(marked()).width;
console.log(sum, show(only(fresh())), show(only(marked())));
