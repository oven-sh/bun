const unseen = (x: any): any => [x][JSON.parse("0")];
const one = (v: any): string => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : String(v));
const show = (x: any): string => { if (!Array.isArray(x) && !ArrayBuffer.isView(x)) return JSON.stringify(x); let s = "["; for (let i = 0; i < (x as any).length; i++) s += (i ? "," : "") + (i in x ? one((x as any)[i]) : "hole"); return s + "]"; };
const pushed = (...values: any[]): any => { const a: any[] = []; for (let i = 0; i < values.length; i++) a.push(values[i]); return unseen(a); };
function copy(row: number[], out: number[]): number { for (let i = 0; i < row.length; i++) out[i] = row[i]; return out[0]; }
function bump(row: number[]): number { for (let x = 0; x < row.length; x++) row[x] += 0.5; return row[0]; }
const holed = (): any => { const a = pushed(1.5, 2.5, 3.5, 4.5); delete a[1]; delete a[3]; return a; };
for (let n = 0; n < 2; n++) { const out = pushed(0.5, 0.5, 0.5, 0.5); copy(holed(), out); const grown = pushed(0.5); grown.length = 3; const into = pushed(9.5, 9.5, 9.5); copy(grown, into); const bumped = holed(); bump(bumped); console.log(show(out), 1 in out, 3 in out, show(into), 1 in into, show(bumped), 1 in bumped); }
