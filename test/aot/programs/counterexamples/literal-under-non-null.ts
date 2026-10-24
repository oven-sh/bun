// Literals with a computed key and with a spread stand under `!`.
declare const console: { log(...values: unknown[]): void };
const k = "x" as string;
const o = ({ t: 1, [k]: 2 })!;
function f(n: number) { return { t: n, u: "u" } }
const p = ({ ...f(1), x: 1 })!;
function take(v: { t: number; u: string; x: number }) { return v.t + v.u + v.x }
console.log(o.t, Object.keys(o).join(), take(p), Object.keys(p).join());
