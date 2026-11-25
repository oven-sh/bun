// A function whose result is a number or undefined hands it back raw where it is called directly. What is handed on as an argument takes a default where it is undefined. It calls itself as often as nobody knows in front, so that the call stays a call wherever its text is copied to.
// STATISTIC: NumbersOrUndefinedReturnedRaw >= 1
const one = Date.now() > 0 ? 1 : 0; let calls = 0;
function maybe(n?: number, depth = one): number | undefined { if (depth > 0) { const r = maybe(n, depth - 1); calls++; return r; } return n; }
function withDefault(a = 10, b: number | undefined = maybe(a > 10 ? a : undefined)): string { return a + ":" + b; }
console.log(maybe(), maybe(undefined), maybe(0), maybe(-0) === 0, Object.is(maybe(-0), -0), withDefault(), withDefault(maybe()), withDefault(maybe(11)), withDefault(maybe(12), maybe()), withDefault(maybe(1), maybe(2)), [maybe(), maybe(1)].length, Math.max(maybe(1)!, maybe(2)!), Math.max(maybe()!, 1));
