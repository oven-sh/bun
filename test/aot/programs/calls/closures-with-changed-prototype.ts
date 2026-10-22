// Calls of functions that were given another prototype, or none, with `Object.setPrototypeOf`.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const none: any = function (this: any) { return "none " + String(this); };
const two: any = function (this: any, a: any, b: any) { return "two " + String(a) + String(b); };
const rest: any = function (this: any, a: any, ...r: any[]) { return "rest " + String(a) + " " + r.length + ":" + r.join(""); };
const arrow: any = (a: any) => "arrow " + String(a);
let captured = 5; const capturing: any = (a: any) => "capturing " + (captured + a);
const typed = (a: number, b: number): number => a * 10 + b;
// `typed` is only ever called with two numbers: an argument of another kind throws a TypeError on entry.
const closures: any[] = [none, two, rest, arrow, capturing];
function callTyped(f: (a: number, b: number) => number, a: number): number { return f(a, 1) + 1; }
const other = { marker: "other", call: Function.prototype.call, apply: Function.prototype.apply };
for (const [label, change] of [["as made", (f: any) => f], ["another prototype", (f: any) => Object.setPrototypeOf(f, other)], ["no prototype", (f: any) => Object.setPrototypeOf(f, null)], ["frozen", (f: any) => Object.freeze(f)]] as [string, (f: any) => any][]) {
  for (const f of [...closures, typed]) attempt(label + " change", () => typeof change(f));
  for (const f of closures) {
    attempt(label + " 0", () => f()); attempt(label + " 1", () => f(1)); attempt(label + " 2", () => f(1, 2)); attempt(label + " 3", () => f(1, 2, 3)); attempt(label + " 9", () => f(1, 2, 3, 4, 5, 6, 7, 8, 9));
    attempt(label + " spread", () => f(...[1, 2, 3])); attempt(label + " Reflect.apply", () => Reflect.apply(f, "t", [1, 2])); attempt(label + " method", () => ({ m: f }).m(4, 5));
    attempt(label + " .call", () => f.call("t", 1, 2)); attempt(label + " marker", () => f.marker); attempt(label + " prototype", () => Object.getPrototypeOf(f) === Function.prototype ? "Function.prototype" : Object.getPrototypeOf(f) === other ? "other" : String(Object.getPrototypeOf(f)));
    attempt(label + " typeof", () => typeof f);
  }
  attempt(label + " callTyped", () => callTyped(typed, 3)); attempt(label + " typed as any", () => (typed as any)(4, 5)); attempt(label + " typed Reflect.apply", () => Reflect.apply(typed, undefined, [6, 7]));
  let s = 0; for (let i = 0; i < 20000; i++) s += callTyped(typed, i & 7); log.push(label + " loop " + s);
}
console.log(log.join("\n"));
export {};
