// An element is stored at `n | 0` and read at `n >>> 0`, with keys inside the array, beyond its end and below zero.
declare const console: { log(...values: unknown[]): void };
function v1(k: number | string): string { const a = [0.5, 1.5, 2.5] as number[]; const o = a as any; const n = Number(k); o[n | 0] = 7.5; return String(o[n >>> 0]) + "," + String(o[n.toString()]); }
function v2(k: number | string): string { const a = [0.5, 1.5, 2.5] as number[]; const o = a as any; const n = Number(k); o[n | 0] = 7.5; return String(o[n >>> 0]); }
function v3(n: number): string { const a = [0.5, 1.5, 2.5] as number[]; const o = a as any; o[n | 0] = 7.5; return String(o[n >>> 0]) + "," + String(o[n.toString()]); }
function v4(k: number | string): string { const o: any = [0.5, 1.5, 2.5]; const n = Number(k); o[n | 0] = 7.5; return String(o[n >>> 0]); }
function v5(k: number | string): string { const a = [0.5, 1.5, 2.5] as number[]; const o = a as any; const n = Number(k); return String(o[n >>> 0]); }
function v6(k: number | string): string { const a = [0.5, 1.5, 2.5] as number[]; const n = Number(k); a[n | 0] = 7.5; return String(a[n >>> 0]); }
function v7(k: number | string): string { const a = [10, 11, 12] as number[]; const o = a as any; const n = Number(k); o[n | 0] = 77; return String(o[n >>> 0]); }
function v8(k: number | string): string { const a = ["a", "b", "c"] as string[]; const o = a as any; const n = Number(k); o[n | 0] = "S"; return String(o[n >>> 0]); }
const all = [v1, v2, v4, v5, v6, v7, v8];
for (let i = 0; i < 200; i++) { for (const f of all) f(i & 1 ? i & 3 : String(i & 3)); v3(i & 3); }
for (const k of [0, 1, 2, 3, 5, 9, -1, 2147483648, 4294967295, "3", "-1"]) console.log(String(k), all.map(f => f(k)).join(" | "), "|", v3(Number(k)));
