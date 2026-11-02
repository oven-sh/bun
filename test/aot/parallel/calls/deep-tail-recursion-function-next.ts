// Two functions call each other in tail position three million deep. One answers `any`, the other declares the type of its result, and nothing else ever comes back: the stack stays level, as it does with the types erased.
interface Box { depth: number }
const hops = 3_000_000;
function anyNumber(n: number, sum: number): any { return n === 0 ? sum : toNumber(n - 1, sum + 1); }
function toNumber(n: number, sum: number): number { return anyNumber(n, sum); }
function anyText(n: number, text: string): any { return n === 0 ? text : toText(n - 1, text); }
function toText(n: number, text: string): string { return anyText(n, text); }
function anyBox(n: number, box: Box): any { return n === 0 ? box : toBox(n - 1, box); }
function toBox(n: number, box: Box): Box { return anyBox(n, box); }
function anyOrNothing(n: number): any { return n === 0 ? undefined : toNumberOrNothing(n - 1); }
function toNumberOrNothing(n: number): number | undefined { return anyOrNothing(n); }
class Counter {
  any(n: number, sum: number): any { return n === 0 ? sum : this.typed(n - 1, sum + 2); }
  typed(n: number, sum: number): number { return this.any(n, sum); }
}
function report(label: string, run: () => unknown): void {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + (error as Error).constructor.name); }
}
report("a number", () => toNumber(hops, 0));
report("a string", () => toText(hops, "end"));
report("an object", () => toBox(hops, { depth: 5 }).depth);
report("a number or nothing", () => toNumberOrNothing(hops));
report("methods", () => new Counter().typed(hops, 0));
export {};
