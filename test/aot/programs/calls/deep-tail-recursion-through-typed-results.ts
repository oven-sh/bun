// Indirect tail calls through functions whose declared return types are number, string and an object type run in constant stack space. The result is tested where the cycle of tail calls is left, after the entire chain has run, against the return type of the function that was called from outside: a mismatch throws a TypeError, whatever the caller does with the value. The two rows that call through `any` record no line for the call site, so they print false for it.
interface Box { depth: number }
const hops = 1_000_000;
const opaque = new Function("value", "return value") as <T>(value: T) => T;
let calls = 0;
let callSiteLine = NaN;
function toNumber(n: number, next: any): number { calls++; return n === 0 ? 0.5 : next[n % next.length](n - 1, next); }
function toText(n: number, next: any): string { calls++; return n === 0 ? "end" : next[n % next.length](n - 1, next); }
function toBox(n: number, next: any): Box { calls++; return n === 0 ? { depth: n } : next[n % next.length](n - 1, next); }
const all = opaque([toNumber, toText, toBox]);
function lineOf(error: unknown): number { return Number(/:(\d+):\d+\)?\s*$/m.exec(String((error as Error).stack))?.[1]); }
function report(label: string, run: () => unknown): void {
  calls = 0;
  callSiteLine = NaN;
  try { console.log(label + ": " + String(run()) + " after " + calls + " calls"); }
  catch (error) { console.log(label + ": " + (error as Error).constructor.name + " after " + calls + " calls, thrown at the call site: " + (lineOf(error) === callSiteLine)); }
}
report("numbers", () => toNumber(hops, opaque([toNumber])) + 1);
report("strings", () => toText(hops, opaque([toText])).length);
report("objects", () => toBox(hops, opaque([toBox])).depth);
report("known callees", () => toNumber(hops, [toNumber]) + 1);
report("mixed callees, matches the caller's type", () => toText(hops, all).length);
report("mixed callees, returned as any", () => (toNumber as any)(hops, all));
report("mixed callees, stored as any", () => { const result: any = (toNumber as any)(hops, all); return result; });
report("mixed callees, used as a number", () => { callSiteLine = lineOf(new Error()); const result: number = toNumber(hops, all); return result; });
report("mixed callees, used as an object", () => { callSiteLine = lineOf(new Error()); const result: Box = toBox(hops, all); return result; });
report("numbers again", () => toNumber(hops, opaque([toNumber])) + 1);
export {};
