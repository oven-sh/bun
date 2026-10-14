// `f.call(..)` and `f.apply(..)` where the property found under `call` or `apply` is not the built-in function.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const plain: any = function (this: any, a: any) { return "plain " + String(this) + " " + a; };
const own: any = function (this: any, a: any) { return "body " + a; };
own.call = function (this: any, a: any, b: any) { return "own call " + (this === own) + " " + a + " " + b; };
own.apply = function (this: any, a: any, b: any) { return "own apply " + (this === own) + " " + a + " " + b; };
const notFunction: any = { call(a: any) { return "method call " + a; }, apply(a: any, b: any) { return "method apply " + a + " " + b; } };
class Static { static call(a: any) { return "static call " + a; } static apply = (a: any, b: any) => "static apply " + a + " " + b; }
class Plain { v = 1; }
const inherits: any = Object.create(Function.prototype);
const reproto: any = function () { return "reproto"; };
Object.setPrototypeOf(reproto, { call() { return "other prototype"; } });
const nullproto: any = function () { return "nullproto"; };
Object.setPrototypeOf(nullproto, null);
const table: any[] = [plain, own, notFunction, Static, Plain, inherits, reproto, nullproto, undefined, null, 1, "s", Math.max, plain.bind("bound")];
for (const f of table) {
  attempt("call", () => f.call("t", 1, 2));
  attempt("apply", () => f.apply("t", [1, 2]));
  attempt("call()", () => f.call());
  attempt("apply()", () => f.apply());
}
// The property appears after the site has run with the built-in function, and goes away again.
const late: any = function (this: any, a: any) { return "late body " + a; };
for (let i = 0; i < 6; i++) {
  if (i === 2) late.call = () => "late own";
  if (i === 4) delete late.call;
  log.push(late.call(null, i));
}
console.log(log.join("\n"));
export {};
