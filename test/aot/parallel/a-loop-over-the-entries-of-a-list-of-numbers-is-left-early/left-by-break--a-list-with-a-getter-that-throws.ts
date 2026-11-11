const log: string[] = [];
const key: "g" = JSON.parse('"g"');
function loud(name: string, values: unknown[], more: Record<string, unknown> = {}): any { let k = 0; return { [Symbol.iterator]() { return this; }, next() { log.push(name + ".next"); return k < values.length ? { done: false, value: values[k++] } : { done: true, value: undefined }; }, return() { log.push(name + ".return"); return {}; }, ...more }; }
class Below extends Array<number> { *entries(): any { try { yield [0, 1.5]; yield [1, 2.5]; yield [2, 3.5]; yield [3, 4.5]; } finally { log.push("finally"); } } }
const U = { check(i: number): number { if (i === 2) throw new EvalError("call"); return 0; }, boom(): number { log.push("default"); throw new EvalError("default"); } };
const other: "check" = JSON.parse('"check"'), third: "boom" = JSON.parse('"boom"');
const T = { g(x: number[]): number { let t = 0; for (const [i, v] of x.entries()) { if (i === 2) break; t += i * 10 + v; } return t; } };
function make(c: number): number[] { return Object.defineProperty([1.5, 2.5, 3.5, 4.5], 2, { get() { log.push("get"); throw new RangeError("getter"); }, configurable: true }); }
const n = 6; for (let c = 0; c < n; c++) { log.length = 0; let said: string; try { said = String(T[key](make(c))); } catch (e: any) { said = "throws " + e.constructor.name + " " + e.message; } if (c === 0 || c === n - 1) console.log(said + " || " + log.join()); }
