interface Options { depth: number; width: number }
let work = 0;
function only(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, given);
}
function copy(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return { ...given, tag: 2 };
}
function fresh(): Options { return { depth: 1, width: 2 }; }
function show(o: any): string {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.keys(o).join() + "|" + o.depth + "|" + o.width + "|" + o.extra + "|" + o.tag;
}
function marked(): Options { const made: any = fresh(); made.extra = 6; return made; }
function unmarked(): Options { const made: any = marked(); delete made.extra; return made; }
function turned(): Options { const made: any = marked(); delete made.depth; made.depth = 9; return made; }
let sum = 0;
for (let i = 0; i < 300; i++) sum += only(fresh()).depth + copy(fresh()).width;
console.log(sum);
for (const make of [fresh, marked, unmarked, turned]) console.log(show(only(make())), show(copy(make())));
