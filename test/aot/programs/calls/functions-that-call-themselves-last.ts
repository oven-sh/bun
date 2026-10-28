// Self tail calls are converted to loops: the function can then be inlined, and an object allocated in each iteration for the next one is not allocated.
// IR= 0 tallied : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 summed CallDirect
// IR= 0 sumTo CallDirect
// IR= 0 swapped CallDirect
// IR= 1 notLast CallDirect
// IR= 1 underHandler CallDirect
declare const console: { log(...v: unknown[]): void };
interface Tally { count: number; sum: number }
function tallyFrom(soFar: Tally, list: number[], at: number, end: number): Tally {
  if (at === end) return soFar;
  return tallyFrom({ count: soFar.count + 1, sum: soFar.sum + list[at]! * soFar.count }, list, at + 1, end);
}
function tallied(list: number[], n: number): number { let t = 0; for (let r = 0; r < n; r++) for (let i = 0; i + 5 <= list.length; i += 5) { const s = tallyFrom({ count: 1, sum: r }, list, i, i + 5); t += s.sum / s.count; } return t; }
function sumTo(n: number, total: number): number { return n === 0 ? total : sumTo(n - 1, total + n); }
function summed(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += sumTo(i, 0); return t; }
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function swapped(n: number): number { let t = 0; for (let i = 1; i < n; i++) t += gcd(i * 6, 84); return t; }

function keepsItsArgument(tally: Tally, n: number): Tally { return n === 0 ? tally : keepsItsArgument(tally, n - 1); }
function withDefault(n: number, step = n * 2, seen: number[] = []): number[] { seen.push(step); return n === 0 ? seen : withDefault(n - 1, undefined, seen); }
function capturesEachTurn(n: number, readers: (() => number)[]): (() => number)[] { readers.push(() => n * 10); return n === 0 ? readers : capturesEachTurn(n - 1, readers); }
function writesItsParameter(n: number, log: string): string { log += n; n -= 2; return n < 0 ? log : writesItsParameter(n, log + ","); }
function notLast(n: number): number { return n === 0 ? 0 : 1 + notLast(n - 1); }
function underHandler(n: number): number { try { return n === 0 ? 0 : underHandler(n - 1); } catch { return -1; } }
function isEven(n: number): boolean { return n === 0 ? true : isOdd(n - 1); }
function isOdd(n: number): boolean { return n === 0 ? false : isEven(n - 1); }
function throwsAtTheEnd(n: number, trail: string): string { if (n === 0) throw new RangeError("after " + trail); return throwsAtTheEnd(n - 1, trail + n); }
function framesAtTheEnd(n: number): number { if (n === 0) return (new Error("x").stack ?? "").split("\n").filter(line => line.includes("framesAtTheEnd")).length; return framesAtTheEnd(n - 1); }
function twoWays(n: number, a: number, b: number): number { if (n <= 0) return a * 1000 + b; if (n & 1) return twoWays(n - 1, a + 1, b); return twoWays(n - 2, a, b + 1); }
class Chain { constructor(readonly next: Chain | null, readonly weight: number) {} }
function walk(link: Chain | null, total: number): number { return link === null ? total : walk(link.next, total + link.weight); }
function narrowed(value: number | string, n: number): string { if (typeof value === "string") return value + n; return narrowed(n > 2 ? value + 1 : "done" + value, n + 1); }

const list: number[] = []; for (let i = 0; i < 60; i++) list.push((i * 29) % 83);
const given: Tally = { count: 1, sum: 2 };
let chain: Chain | null = null; for (let i = 0; i < 100; i++) chain = new Chain(chain, i);
let caught = ""; try { throwsAtTheEnd(4, ">"); } catch (e) { caught = (e as Error).message; }
console.log(tallied(list, 3), summed(50), swapped(40), sumTo(1000000, 0), keepsItsArgument(given, 5) === given, withDefault(3).join(), capturesEachTurn(3, []).map(read => read()).join());
console.log(writesItsParameter(7, ""), notLast(50), underHandler(50), isEven(1001), caught, framesAtTheEnd(5), twoWays(11, 0, 0), walk(chain, 0), narrowed(0, 0));
