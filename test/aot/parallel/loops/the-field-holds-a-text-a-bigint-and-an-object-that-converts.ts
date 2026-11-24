const said: unknown[] = [];
function outside<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function hidden<T>(value: T): T { return ({ value } as any)[JSON.parse('"value"')]; }
type Entry = { time: number; value: number };
function lowerBound<T, K>(items: readonly T[], key: K, compare: (item: T, key: K) => number): number {
  let low = 0, high = items.length;
  while (low < high) { const middle = (low + high) >>> 1; if (compare(items[middle]!, key) < 0) low = middle + 1; else high = middle; }
  return low;
}
let converted = 0; const odd: any[] = [{ time: '5' }, { time: { valueOf() { converted++; return 15; } } }, { time: 25 }, { time: '35' }];
for (const time of outside([0, 10, 20, 30, 40])) said.push(lowerBound(odd as Entry[], time, (entry, key) => entry.time - key), converted);
try { said.push(lowerBound([{ time: 5n }] as any as Entry[], 1, (entry, key) => entry.time - key)); } catch (error) { said.push((error as Error).constructor === TypeError); }
console.log(said.join(" | "));
export {};
