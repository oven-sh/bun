const out: string[] = [];
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : v instanceof Error ? v.name + " " + v.message : typeof v === "object" && v !== null ? "[" + String((v as { length?: number }).length) + "]" : typeof v === "string" ? '"' + v + '"' : String(v);
let asked = 0;
const noisy = (value: unknown) => ({ valueOf() { asked++; return value; } });
const plain: number[] = JSON.parse("[0,1,2,3,-1,-2,-3,4,7,8,255,256,2147483647,-2147483648,4294967296,4294967297]");
const odd: number[] = JSON.parse("[1.5,-0,1e21,9007199254740992,9007199254740991,-4294967298,0.1]").concat([NaN, Infinity, -Infinity]);
const strange = [4, "4", "x", "", true, null, undefined, noisy(6), noisy("8"), [4], [], 3, -0, noisy(-2)] as unknown as number[];
const throwing = [2, { valueOf() { throw new RangeError("value"); } }, 4] as unknown as number[];
const large = [2, 10n, 4] as unknown as number[];
const marked = [6, Symbol("s"), 8] as unknown as number[];
function* evens(list: number[]): Generator<number> { for (const n of list) if (n % 2 === 0) yield n; }
function* take(source: Iterable<number>, count: number): Generator<number> { for (const n of source) { if (count-- <= 0) return; yield n; } }
const isThird = (n: number): boolean => n % 3 === 1;
function forms(list: number[]): string {
  let even = 0, odds = 0, four = 0, third = 0, minus = 0, truthy = 0, falsy = 0, loose = 0, unequal = 0, big = 0, both = 0;
  for (const n of list) {
    if (n % 2 === 0) even++;
    if (n % 2 === 1) odds++;
    if (n % 2 === -1) minus++;
    if (n % 4 === 0) four++; else four -= 100;
    if (isThird(n)) third++;
    if (n % 7) truthy++;
    if (!(n % 10)) falsy++;
    if ((n % 3 as unknown) == 0) loose++;
    if (n % 5 !== 2) unequal++;
    if (n % 2147483647 === 1) big++;
    const m = n % 2;
    if (m === 0) both += 1; else both += 1000;
    if (m === 0 || n % 3 === 0) both += 10;
  }
  return [even, odds, minus, four, third, truthy, falsy, loose, unequal, big, both].join();
}
function kept(list: number[]): string {
  const hits: unknown[] = [];
  for (let k = 0; k < list.length; k++) { const n = list[k]; const r = n % 4; const isZero = r === 0; hits.push(r, isZero); }
  return hits.map(show).join();
}
function attempt(name: string, run: () => string): void { try { out.push(name + " " + run()); } catch (error) { out.push(name + " threw " + show(error)); } out.push("asked " + asked); }
for (const [name, list] of [["plain", plain], ["odd", odd], ["strange", strange], ["throwing", throwing], ["large", large], ["marked", marked], ["again", plain]] as [string, number[]][]) {
  attempt(name + " forms", () => forms(list));
  attempt(name + " kept", () => kept(list));
  attempt(name + " evens", () => [...take(evens(list), 6)].map(show).join());
  attempt(name + " summed", () => { let total = 0; for (const n of take(evens(list), list.length)) total += n & 255; return String(total); });
  attempt(name + " filtered", () => list.filter(n => n % 2 === 0).map(show).join());
  attempt(name + " caught", () => { let caught = 0; for (const n of list) { try { if (n % 2 === 0) caught++; } catch { caught += 100; } finally { caught += 1000; } } return String(caught); });
}
console.log(out.join("\n"));
