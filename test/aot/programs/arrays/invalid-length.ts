// `Array(n)` and `new Array(n)` where `n` is a number that is no length: the error is the engine's, word for word, whether the number is typed, predicted or unknown.
function typed(n: number): number { return Array(n).length; }
function typedNew(n: number): number { return new Array<string>(n).length; }
function predicted(list: any, start: any): number { return Array(Math.max(list.length - start, 0)).length; }
function unknown(n: any): number { return Array(n).length; }
function attempt(f: (...values: any[]) => number, ...values: any[]): string {
  try { return String(f(...values)); } catch (error: any) { return error.name + ": " + error.message; }
}
for (const n of [0, 3, -0, -1, 1.5, NaN, Infinity, -Infinity, 4294967295, 4294967296, 2 ** 53]) {
  if (n === 4294967295) continue;
  console.log(n, attempt(typed, n), "|", attempt(typedNew, n), "|", attempt(unknown, n));
}
for (const start of [0, 1, 5, "1", "call", undefined, null, {}, -1.5]) console.log(String(start), attempt(predicted, [1, 2, 3], start));
