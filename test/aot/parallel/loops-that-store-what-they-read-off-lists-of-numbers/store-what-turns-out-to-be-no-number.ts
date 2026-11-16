const unseen = (x: any): any => [x][JSON.parse("0")];
const one = (v: any): string => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : String(v));
const show = (x: any): string => { if (!Array.isArray(x) && !ArrayBuffer.isView(x)) return JSON.stringify(x); let s = "["; for (let i = 0; i < (x as any).length; i++) s += (i ? "," : "") + (i in x ? one((x as any)[i]) : "hole"); return s + "]"; };
const pushed = (...values: any[]): any => { const a: any[] = []; for (let i = 0; i < values.length; i++) a.push(values[i]); return unseen(a); };
function less(row: number[], out: number[]): number { for (let i = 0; i < row.length; i++) out[i] = row[i] - row[i]; return out[0]; }
function times(row: number[]): number { for (let x = 0; x < row.length; x++) row[x] = row[x] * 0.5 - row[x] * 0.5; return row[0]; }
function over(row: number[], out: number[]): number { for (let i = 0; i < row.length; i++) out[i] = row[i] / row[i]; return out[0]; }
for (let n = 0; n < 2; n++) { const a = pushed(0.5, 0.5, 0.5); less(pushed(1.5, Infinity, 2.5), a); const b = pushed(1.5, -Infinity, 2.5); times(b); const c = pushed(0.5, 0.5, 0.5); over(pushed(1.5, 0.25 - 0.25, Infinity), c); console.log(show(a), show(b), show(c), 1 in a, 1 in b, 1 in c); }
