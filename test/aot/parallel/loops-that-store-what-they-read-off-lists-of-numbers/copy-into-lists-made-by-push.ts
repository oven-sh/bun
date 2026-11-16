const unseen = (x: any): any => [x][JSON.parse("0")];
const one = (v: any): string => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : String(v));
const show = (x: any): string => { if (!Array.isArray(x) && !ArrayBuffer.isView(x)) return JSON.stringify(x); let s = "["; for (let i = 0; i < (x as any).length; i++) s += (i ? "," : "") + (i in x ? one((x as any)[i]) : "hole"); return s + "]"; };
const pushed = (...values: any[]): any => { const a: any[] = []; for (let i = 0; i < values.length; i++) a.push(values[i]); return unseen(a); };
function copy(row: number[], out: number[]): number { for (let i = 0; i < row.length; i++) out[i] = row[i]; return out[0]; }
const ask = (row: any, out: any) => { try { copy(row, out); return show(out); } catch (e: any) { return e.constructor.name + " " + show(out); } };
for (let n = 0; n < 2; n++) console.log(ask(pushed(1.5, 2.5), pushed(0.5, 0.5)), ask(pushed(1.5, 2.5, 3.5), pushed(0.5)), ask(pushed(1.5, 2.5), pushed()), ask(pushed(1.5, 2.5), pushed(1, 2)), ask(pushed(1, 2), pushed(0.5, 0.5)), ask(pushed(1, 2), pushed(3, 4)), ask(pushed(1.5, 2.5), pushed("a", "b")), ask(pushed(1.5, 2.5), Object.freeze(pushed(0.5, 0.5))), ask(pushed(1.5, 2.5, 3.5), Object.preventExtensions(pushed(0.5, 0.5))));
