
type Named = { name: string; rank: number };
function best<T extends Named>(items: T[], score: (item: T) => number): T | undefined {
  let found: T | undefined;
  let top = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > top) { top = s; found = item; }
  }
  return found;
}
function label<T extends Named>(item: T | undefined): string {
  return item === undefined ? "none" : JSON.stringify(item);
}
const people: Named[] = JSON.parse(process.argv[2] ?? '[{"name":"a","rank":2},{"name":"b","rank":5}]');
console.log(label(best(people, p => p.rank)), label(best([{ name: "z", rank: 1 }], p => p.name.length)));
