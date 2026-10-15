// Indirect calls of every kind of function with every number of arguments.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const none: any = function (this: any) { return "none " + String(this); };
const two: any = function (this: any, a: any, b: any) { return "two " + String(a) + String(b); };
const rest: any = function (this: any, a: any, ...r: any[]) { return "rest " + String(this) + String(a) + " " + r.length + ":" + r.join(""); };
const onlyRest: any = (...r: any[]) => "onlyRest " + r.length + ":" + r.join("");
const ten: any = function (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { return "ten " + [a, b, c, d, e, f, g, h, i, j].map(String).join(""); };
const uses: any = function () { return "arguments " + arguments.length + ":" + Array.prototype.join.call(arguments, ""); };
const withDefault: any = (a: any = "d", b: any = a + "e") => "default " + a + b;
class K { constructor(public v: any) {} static s(a: any) { return "static " + a; } m(a: any) { return "method " + this.v + a; } }
const asynchronous: any = async (a: any) => a;
const generator: any = function* (a: any, ...r: any[]) { yield a; yield r.length; };
const closures: any[] = [none, two, rest, onlyRest, ten, uses, withDefault, K.s, K];
const args = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let round = 0; round < 2; round++) {
  for (const f of closures) {
    attempt("0", () => f()); attempt("1", () => f(1)); attempt("2", () => f(1, 2)); attempt("3", () => f(1, 2, 3)); attempt("4", () => f(1, 2, 3, 4)); attempt("5", () => f(1, 2, 3, 4, 5));
    attempt("8", () => f(1, 2, 3, 4, 5, 6, 7, 8)); attempt("9", () => f(1, 2, 3, 4, 5, 6, 7, 8, 9)); attempt("12", () => f(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
    for (let n = 0; n <= 12; n++) { attempt("apply " + n, () => f.apply("t", args.slice(0, n))); attempt("spread " + n, () => f(...args.slice(0, n))); }
    attempt("call", () => f.call("t", 1, 2, 3, 4, 5, 6, 7, 8, 9));
  }
  // The second round: each has an own property, and therefore a different structure.
  for (const f of closures) f.extra = round;
}
log.push(typeof asynchronous(1).then, [...generator(1, 2, 3)].join(","), typeof asynchronous.call(null, 1).then, [...generator.apply(null, [1, 2])].join(","));
asynchronous.p = 1; generator.p = 1;
log.push(typeof asynchronous(1).then, [...generator(1, 2, 3)].join(","));
function deep(n: number, f: any): any { return n ? f.call(null, n - 1, f) : "bottom"; }
log.push(deep(1000, deep));
console.log(log.join("\n"));
export {};
