// `n.total = 7` on a `Record<string, number>` is not lost when a loop below stores by computed keys.
declare const console: { log(...a: unknown[]): void };
function f(s: string[]) {
  const n: Record<string, number> = {};
  if (s.length) s.pop();
  n.total = 7;
  for (const w of s) n[w] = 1;
  return n.total;
}
console.log(f([]));
