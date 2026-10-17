// Bound functions: with and without bound arguments, of other bound functions, of classes, constructed, and `call` bound to non-callable values.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const show: any = function (this: any, ...a: any[]) { return String(this) + " " + a.length + ":" + a.join(","); };
function Point(this: any, x: any, y: any) { this.x = x; this.y = y; }
class K { constructor(public v: any) {} }
const bound: any[] = [show.bind("t"), show.bind("t", 1), show.bind("t", 1, 2, 3, 4, 5, 6, 7, 8, 9), show.bind("a").bind("b"), show.bind("a", 1).bind("b", 2), show.bind(undefined), show.bind(),
  Math.max.bind(null), Math.max.bind(null, 5), (K as any).bind(null), Function.prototype.call.bind(show), Function.prototype.call.bind(show, "t"), Function.prototype.apply.bind(show),
  Function.prototype.call.bind(Math.max), Function.prototype.call.bind({} as any), Function.prototype.call.bind(K), Function.prototype.call.bind(show.bind("inner"))];
for (let round = 0; round < 2; round++) {
  for (const f of bound) {
    attempt("0", () => f()); attempt("1", () => f("x")); attempt("2", () => f("x", [7, 8])); attempt("9", () => f(1, 2, 3, 4, 5, 6, 7, 8, 9));
    attempt("call", () => f.call("other", "x")); attempt("apply", () => f.apply("other", ["x", [1]]));
  }
  for (const f of bound) f.extra = round;
}
const BoundPoint: any = (Point as any).bind(null, 1);
const p = new BoundPoint(2);
log.push(p.x, p.y, p instanceof (Point as any), new ((K as any).bind(null, 5))().v, show.bind("t").name, show.bind("t", 1).length);
console.log(log.map(String).join("\n"));
export {};
