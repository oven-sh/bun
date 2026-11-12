// a loop over a list of numbers turns the list into fractions and breaks
interface Item { weight: number; name: string }
const log: string[] = [];
(globalThis as any).seen = (x: unknown) => { if (log.length < 6) log.push(String(typeof x === "object" && x ? (x as Item).weight : x)); };
function items(): Item[] { return [{ weight: 2, name: "a" }, { weight: 3.5, name: "b" }, { weight: 7, name: "c" }, { weight: 11, name: "d" }]; }
function withStranger(at: number): Item[] { const list = items(); list[at] = JSON.parse('{"name":"zz","extra":1,"weight":5}'); return list; }
function withNumber(): Item[] { const list: any[] = items(); list[1] = 6; return list; }
function overPrototype(): number[] { const list = [1, , 3] as number[]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { get() { log.push("asked above"); return 20; } } })); return list; }
function withAccessor(): number[] { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { log.push("accessor"); return 40; } }); return list; }
function* counting() { try { yield 1; yield 2; yield 3; yield 4; yield 5; } finally { log.push("generator closed"); } }
function closable() { let n = 0; return { [Symbol.iterator]() { return this; }, next() { return n < 6 ? { done: false, value: ++n } : { done: true, value: undefined }; }, return() { log.push("return called"); return {}; } }; }
function withOwnIterator(): number[] { const list = [1, 2, 3]; (list as any)[Symbol.iterator] = function* () { log.push("own iterator"); yield 5; yield 6; }; return list; }
function asArguments(..._: number[]) { return (function () { return arguments; }).apply(null, _ as any); }
function weigh(x: unknown): number { return typeof x === "number" ? x : typeof x === "object" && x ? (x as Item).weight : typeof x === "string" ? x.length : x === undefined ? 1000 : 0; }
function run(what: number[]): string {
  let total = 0, count = 0;
  for (const x of what) {
    total += weigh(x); if (count++ === 0 && Array.isArray(what) && what.length > 2) (what as any)[2] = 0.125;
    if (count > 2 || total > 50) break;
  }
  return total + " " + count;
}
(globalThis as any).kept = run;
function once(what: any): string { try { return run(what); } catch (error) { return "caught " + (error as Error).message; } }
let warm = "";
for (let i = 0; i < 40; i++) warm = once([1, 2, 3, 4, 5]);
log.length = 0;
console.log(warm, "|", once([3, 1, 4, 1, 5, 9, 2, 6]), "|", once([3, 1, 4, 1, 5, 9, 2, 6]), "|", once([1, 2, 3, 4, 5]), "|", log.join(","));
