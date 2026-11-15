// A function whose result is a number or undefined hands it back raw where it is called directly. Each taker sees undefined as undefined and a number as that number. It calls itself as often as nobody knows in front, so that the call stays a call wherever its text is copied to.
// STATISTIC: NumbersOrUndefinedReturnedRaw >= 1
const one = Date.now() > 0 ? 1 : 0; let calls = 0;
function positive(n: number, depth = one): number | undefined { if (depth > 0) { const r = positive(n, depth - 1); calls++; return r; } if (n > 0) return n; }
function show(n: number): string {
  const r = positive(n);
  const parts: unknown[] = [r, typeof r, r === undefined, r == null, r ?? "none", r ? "yes" : "no", `${r}`, String(r), r! + 1, -r!, r! | 0, r! * 2, [r].length, [r][0], { r }.r, JSON.stringify([r]), JSON.stringify({ r }), Object.is(r, undefined), Object.is(r, -0), Number.isNaN(r)];
  return parts.map(String).join(",");
}
for (const n of [3, 0, -1, 0.5, -0, NaN, Infinity, -Infinity, 2147483648, -2147483649, 9007199254740991, 5e-324]) console.log(show(n));
