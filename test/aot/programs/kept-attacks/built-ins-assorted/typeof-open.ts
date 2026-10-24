// Built ins assorted: typeof open. It prints what plain Bun prints.
declare var window: unknown;
declare var document: unknown;

function testsAbsent(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (typeof window !== "undefined") c++;
    if (typeof document === "undefined") c += 2;
  }
  return c;
}

function testsPresent(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (typeof process !== "undefined") c += 1;
    if (typeof Bun !== "undefined") c += 2;
    if (typeof setTimeout === "function") c += 4;
  }
  return c;
}

console.log(testsAbsent(100000), testsPresent(100000));
(0, eval)(process.argv.length > 99 ? "1" : "globalThis.window = 1");
console.log(testsAbsent(100000), testsPresent(100000));
