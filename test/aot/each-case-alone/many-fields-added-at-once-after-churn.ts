// A run of stores in typed code gives an object 10, 11 or 13 late fields at once, one more field that ranks last follows, and every field is read back.
// Before that, objects of the same sizes are filled and dropped, so that the cells that are handed out again still hold old bytes.
declare const console: { log(...values: unknown[]): void };
declare const Bun: { gc(force: boolean): void };
function t(name: string, f: () => unknown) { let r: string; try { r = JSON.stringify(f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name + ": " + e.message : typeof e); } console.log(name, r); }
class Late {
  first = 1;
  a00?: object; a01?: object; a02?: object; a03?: object; a04?: object; a05?: object; a06?: object; a07?: object; a08?: object; a09?: object; a10?: object; a11?: object; a12?: object; a13?: object; a14?: object; a15?: object;
}
const mark = (n: number): object => ({ n });
function ten(o: Late, k: number) { o.a00 = mark(k); o.a01 = mark(k + 1); o.a02 = mark(k + 2); o.a03 = mark(k + 3); o.a04 = mark(k + 4); o.a05 = mark(k + 5); o.a06 = mark(k + 6); o.a07 = mark(k + 7); o.a08 = mark(k + 8); o.a09 = mark(k + 9); }
function eleven(o: Late, k: number) { ten(o, k); o.a10 = mark(k + 10); }
function thirteen(o: Late, k: number) { eleven(o, k); o.a11 = mark(k + 11); o.a12 = mark(k + 12); }
function sixteen(o: Late, k: number) { thirteen(o, k); o.a13 = mark(k + 13); o.a14 = mark(k + 14); o.a15 = mark(k + 15); }
function churn() { let kept: Late[] = []; for (let round = 0; round < 6; round++) { kept = []; for (let i = 0; i < 3000; i++) { const o = new Late(); sixteen(o, i); kept.push(o); } Bun.gc(true); } kept.length = 0; Bun.gc(true); }
const absent = (o: Late) => Object.keys(o).length;
const all = (o: Late) => [o.a00, o.a01, o.a02, o.a03, o.a04, o.a05, o.a06, o.a07, o.a08, o.a09, o.a10, o.a11, o.a12, o.a13, o.a14, o.a15].map(v => (v === undefined ? "-" : (v as { n: number }).n)).join();
t("ten at once, then the last", () => { churn(); const out: string[] = []; for (let i = 0; i < 500; i++) { const o = new Late(); ten(o, i); const before = all(o); o.a15 = mark(-1); if (i % 125 === 0) out.push(before, all(o), String(absent(o))); } return out; });
t("ten at once, then the next", () => { churn(); const out: string[] = []; for (let i = 0; i < 500; i++) { const o = new Late(); ten(o, i); o.a10 = mark(-1); if (i % 125 === 0) out.push(all(o), String(absent(o))); } return out; });
t("eleven at once, then the last", () => { churn(); const out: string[] = []; for (let i = 0; i < 500; i++) { const o = new Late(); eleven(o, i); o.a15 = mark(-1); if (i % 125 === 0) out.push(all(o), String(absent(o))); } return out; });
t("thirteen at once, then two more", () => { churn(); const out: string[] = []; for (let i = 0; i < 500; i++) { const o = new Late(); thirteen(o, i); o.a13 = mark(-1); o.a15 = mark(-2); if (i % 125 === 0) out.push(all(o), String(absent(o))); } return out; });
t("ten at once, nothing more: the rest stays absent", () => { churn(); let wrong = 0; for (let i = 0; i < 2000; i++) { const o = new Late(); ten(o, i); if (o.a10 !== undefined || o.a11 !== undefined || o.a12 !== undefined || o.a13 !== undefined || o.a14 !== undefined || o.a15 !== undefined || "a10" in o || absent(o) !== 11) wrong++; } return wrong; });
t("appended one by one after ten, collected in between", () => { churn(); const kept: Late[] = []; for (let i = 0; i < 400; i++) { const o = new Late(); ten(o, i); kept.push(o); } Bun.gc(true); for (const o of kept) o.a10 = mark(10); Bun.gc(true); for (const o of kept) o.a11 = mark(11); Bun.gc(true); for (const o of kept) o.a12 = mark(12); Bun.gc(true); return [all(kept[0]), all(kept[399]), kept.every(o => absent(o) === 14)]; });
