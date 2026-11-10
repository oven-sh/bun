interface Item { name: string; next: () => number; k: number }
function make(k: number): Item {
  let n = k;
  return { name: "n" + k, next: () => ++n, k };
}
function spoil(m: any, key: string): void { m[key] = 1; }
if (process.argv.length > 90) spoil(new Map(), process.argv[3]);
function add(table: Map<unknown, unknown>, bases: Item[]): void {
  for (const base of bases) {
    const seen = table.get(base.name);
    if (!seen || (seen as any).k > 90) {
      table.set(base.name, base.next);
      table.set(base.next, base.name);
    }
  }
}
function spoilt(t: any): void { if (process.argv.length > 90) spoil(t, process.argv[4]); }
for (let k = 0; k < 9; k++) {
  const t = new Map<unknown, unknown>();
  spoilt(t);
  const mixed: any[] = [make(k), new Date(k), make(k + 1)];
  add(t, k & 1 ? mixed : [mixed[0], mixed[2]]);
  console.log("SAID", k, t.size, [...t.keys()].filter((x) => typeof x === "string").join());
}
