// Elements read boxed that are arguments of a method whose result is returned: the method is called in front of its read, with the words that its arguments have then.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const int32s = (): number[] => parse("[5,1,-3,0,2,3,100000,4]");
const doubles = (): number[] => parse("[5.5,1,-0.0,0,1e300,2,-2.25]");
const holes = (): number[] => { const a = int32s(); delete a[3]; return a; };
const mixed = (): any[] => [1, "2", 3.5, null, undefined, 4];
function slice(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.slice(v); } return "none"; }
function at(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.at(v); } return "none"; }
function indexOf(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.indexOf(v); } return "none"; }
function includes(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.includes(v); } return "none"; }
function get(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.get(v); } return "none"; }
function has(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.has(v); } return "none"; }
function set(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.set(v, i); } return "none"; }
function push(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.push(v); } return "none"; }
function substring(x: any, values: number[], k: number): any { for (let i = 0; i + 1 < values.length; i++) { const v = values[i]; const w = values[i + 1]; if (i === k) return x.substring(v, w); } return "none"; }
function charCodeAt(x: any, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.charCodeAt(v); } return "none"; }
function first(x: any, values: number[]): any { for (const v of values) return x.at(v); return "none"; }
function firstOf(x: any, values: number[], k: number): any { for (const v of values) if (--k < 0) return x.indexOf(v); return "none"; }
function typed(x: string, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.charAt(v); } return "none"; }
function either(x: string | number[], values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.slice(v); } return "none"; }
function map(x: Map<number, string>, values: number[], k: number): any { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.get(v); } return "none"; }
function swap(x: any, values: number[], k: number): any { while (k < values.length) { const v = values[k]; if (k % 3 === 2) return x.at(v); k++; } return "none"; }
function inTry(x: any, values: number[], k: number): any { try { for (let i = 0; i < values.length; i++) { const v = values[i]; if (i === k) return x.at(v); } } catch (error) { return "caught"; } return "none"; }
const arrow = (x: any, values: number[], k: number): any => { let i = 0; for (;;) { const v = values[i]; if (i++ === k) return x.at(v); if (i > 9) return "none"; } };
class Holder { items = [10, 11, 12]; constructor(public list: number[]) {} at(v: number): any { return "own" + v; } slice(v: number): any { return "own" + v; } pick(k: number): any { const { list } = this; for (let i = 0; i < list.length; i++) { const v = list[i]; if (i === k) return this.items.at(v); } return "none"; } }
const receivers = (): any[] => ["abcdefgh", [0, 1, 2, 3, 4, 5.5, 5], new Holder([1, 2]), new Uint8Array([1, 2, 3, 4, 5, 6])];
for (let round = 0; round < 3; round++) {
  for (const make of [int32s, doubles, holes, mixed as any]) {
    for (let k = -1; k < 9; k++) {
      for (const x of receivers()) {
        for (const f of [slice, at, first, swap, inTry, arrow, either] as any[]) { try { show(f(x, make(), k)); } catch (error: any) { show(error.constructor.name); } }
      }
      const text = "abcdefgh", list = [0, 1, 2, 3, 4, 5.5, 5, 100000];
      show(indexOf(list, make(), k), includes(list, make(), k), firstOf(list, make(), k), substring(text, make(), k), charCodeAt(text, make(), k), typed(text, make(), k));
      const m = new Map<any, any>([[5, "five"], [5.5, "half"], [0, "zero"], [1, "one"], ["2", "text"], [undefined, "nothing"]]), s = new Set<any>([5, 5.5, 0, 100000, null]);
      show(get(m, make(), k), has(m, make(), k), has(s, make(), k), map(m, make(), k), new Holder(make()).pick(k));
      const pushed: any[] = [], mm = new Map<any, any>(); show(push(pushed, make(), k), pushed); set(mm, make(), k); show([...mm]);
    }
  }
}
console.log(log.length, log);
