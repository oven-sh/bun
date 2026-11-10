// STATISTIC: CopiesWalkedWhereTheirGuardsFail >= 1
const said: unknown[] = [];
function outside<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function hidden<T>(value: T): T { return ({ value } as any)[JSON.parse('"value"')]; }
type Entry = { time: number; value: number };
function lowerBound<T, K>(items: readonly T[], key: K, compare: (item: T, key: K) => number): number {
  let low = 0, high = items.length;
  while (low < high) { const middle = (low + high) >>> 1; if (compare(items[middle]!, key) < 0) low = middle + 1; else high = middle; }
  return low;
}
const entries = outside<Entry[]>(Array.from({ length: 16 }, (_, i) => ({ time: i * 10, value: i + 0.5 })));
for (const time of outside([0, 35, 70, 151, -4])) said.push(lowerBound(entries, time, (entry, key) => entry.time - key));
console.log(said.join(" | "));
export {};
