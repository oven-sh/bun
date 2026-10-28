// Interpreted code (new Function) calls a compiled function, which tail-calls `f.apply(thisArg, list)` with a list that is not a
// plain array, and `f` is interpreted code that throws. The call goes through C++ and a nested VM entry. Unwinding to that
// entry must not restore the registers saved by the adapter frame on the far side of it.
// The text of the language's own TypeError is left out: only the program's own begin with "thrown".
function row(name: string, run: () => unknown) { let line: string; try { line = name + ": " + String(run()); } catch (e) { line = name + ": caught " + String(e); } console.log(line.replace(/TypeError: (?!thrown ).*/, "TypeError")); }
const throwsError = new Function("a", "throw new TypeError('thrown ' + a);");
const throwsNumber = new Function("a", "throw 1;");
const readsNull = new Function("a", "return null.x;");
const throwsDeeper = new Function("a", "function inner() { throw new RangeError(a); } return inner();");
const returns = new Function("a", "return 'returned ' + a;");
let callee: Function = returns;
function viaApply(list: unknown): unknown { return callee.apply(undefined, list as any); }
const tailCaller = new Function("f", "x", "return f(x);");
const plainCaller = new Function("f", "x", "var r = f(x); return r;");
const catchingCaller = new Function("f", "x", "try { return f(x); } catch (e) { return 'caught inside ' + e; }");
const arrayLike = () => ({ length: 1, 0: "a" });
for (const [name, next] of Object.entries({ returns, throwsError, throwsNumber, readsNull, throwsDeeper })) {
  callee = next;
  row(name + ", tail caller", () => tailCaller(viaApply, arrayLike()));
  row(name + ", plain caller", () => plainCaller(viaApply, arrayLike()));
  row(name + ", catching caller", () => catchingCaller(viaApply, arrayLike()));
  row(name + ", compiled caller", () => viaApply(arrayLike()));
  row(name + ", a plain array", () => tailCaller(viaApply, ["b"]));
}

class Loud<T> extends Array<T> {}
(Loud.prototype as any).map = function (this: unknown, ...given: unknown[]) { return throwsError.apply(given, this); };
function mapped(a: string[]): unknown { return a.map(x => x); }
row("an overridden map", () => tailCaller(mapped, Object.setPrototypeOf(["a", "b", "c"], Loud.prototype)));

let sum = 0;
for (let i = 0; i < 1000; i++) { try { tailCaller(viaApply, arrayLike()); } catch { sum += i; } }
console.log(sum, [1.5, 2.5].map(x => x * 2).join(), "text".toUpperCase());
