// Lists filled by a loop and then stored into, beyond the end too, with planned room: their length and contents.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${JSON.stringify(value)}`);
function zeros(n: number, at: number): number[] { const a: number[] = []; for (let k = 0; k < n; k++) a.push(0); a[at] = 1; return a; }
function before(n: number): number[] { const a: number[] = []; a[0] = 7; for (let k = 0; k < n; k++) a.push(k); return a; }
function far(n: number): number[] { const a: number[] = []; for (let k = 0; k < n; k++) a.push(k); a[n + 3] = 9; return a; }
function veryFar(n: number): number { const a: number[] = []; for (let k = 0; k < n; k++) a.push(k); a[100000] = 9; return a.length; }
function fractions(n: number): number[] { const a: number[] = []; for (let k = 0; k < n; k++) a.push(k); a[0] = 0.5; a[1] = NaN; return a; }
function objects(n: number): unknown[] { const a: unknown[] = []; for (let k = 0; k < n; k++) a.push(k); a[0] = "text"; return a; }
function earlyStop(n: number): number[] { const a: number[] = []; for (let k = 0; k < n; k++) { if (k === 2) break; a.push(k); } a[1] = 5; return a; }
for (const n of [0, 1, 3, 16]) show("n", [zeros(n, 0), zeros(n, 2), before(n), far(n), veryFar(n), fractions(n), objects(n), earlyStop(n)]);
let sum = 0; for (let i = 0; i < 100000; i++) sum += zeros(16, i & 15)[3]! + zeros(16, i & 15).length; show("sum", sum);
console.log(out.join("\n"));
