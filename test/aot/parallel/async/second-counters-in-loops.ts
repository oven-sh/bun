// A second counter that an outer loop's iterations change by written integers, beside the counter of an inner loop: in arms that await, and in loops nested by hand.
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
async function soon(v: any): Promise<any> { await null; return v; }
async function sums(): Promise<any> { let n = 0, s = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += 1000000000000; } s += n; n++; } return n + " " + s; }
async function cuts(): Promise<any> { let n = 0, s = 0; for (let i = 0; i < 12; i++) { n += 2; s += (n & 7) + (n >> 1) + (n >>> 1); n++; if (i === 7) { n = 4294967295; await null; } } return n + " " + s; }
async function compares(): Promise<any> { let n = 0, s = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += 1000; } s += n > 50 ? 1 : n < 0 ? 100 : 10; n++; } return n + " " + s; }
async function negative(): Promise<any> { let n = 0, s = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await soon(1); n -= 3000000000; } s += n < 0 ? 1 : 10; n++; } return n + " " + s; }
async function elements(): Promise<any> { const list = new Float64Array(16).fill(1.5); let n = 0, s: any = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += 40; } s += list[n++] ?? 900; } return n + " " + s; }
async function words(): Promise<any> { const list = ["a", "bb", "ccc", "dddd", "e", "ff", "g", "hh"]; let n = 0, s = 0; for (let i = 0; i < list.length; i++) { s += list[n]?.length ?? 70; n += 2; s += list.length > n ? 1 : 2; if (i === 5) { n -= 70000; await soon(1); } } return n + " " + s; }
async function characters(): Promise<any> { const text = "abcdefghijkl"; let n = 0, t = ""; for (let i = 0; i < 8; i++) { if (i === 2) { await soon(1); n += 40; } t += text[n] ?? "-"; n++; } return n + " " + t; }
async function keys(): Promise<any> { const list: any[] = []; let n = 0; for (let i = 0; i < 8; i++) { if (i === 5) { await null; n = 4294967295; } list[n++] = i; } return [n, list.length, Object.keys(list).join()].join(" "); }
async function views(): Promise<any> { const all = [new Uint8Array(16).fill(1), new Uint8Array(16), new Uint8Array(16).fill(2)]; const view = all[1]; let n = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += 20; } view[n++] = 200; } return n + " " + all.map(v => v.join("")).join(" "); }
async function sumsByHand(): Promise<any> { let n = 0, i = 0, s = 0; outer: for (;;) { for (; i < 8; i++) { if (i === 2) { await null; n += 1000000000000; i++; continue outer; } s += n; n++; } break; } return n + " " + s; }
async function elementsByHand(): Promise<any> { const list = new Float64Array(16).fill(1.5); let n = 0, i = 0, s: any = 0; outer: for (;;) { for (; i < 8; i++) { if (i === 2) { await null; n = 15; i++; continue outer; } s += list[n++] ?? 900; s += list[n] ?? 30; } break; } return n + " " + s; }
async function comparesByHand(): Promise<any> { const list = ["a", "b", "c", "d"]; let n = 0, i = 0, s = 0; outer: for (;;) { for (; i < 12; i++) { n--; s += n; n += 2; s += list.length > n ? 1 : 2; if (i === 0) { n += 4503599627370496; await null; i++; continue outer; } } break; } return n + " " + s; }
async function repeats(): Promise<any> { let n = -1, i = 0, r = 0, t = ""; const text = "abcdefghijkl"; do { for (; i < 8; i++) { t += text[n] ?? "-"; n++; if (i === 2) { i++; break; } } await null; n = 4294967295; r++; } while (i < 8 && r < 4); return n + " " + t; }
async function stepsBy(k: number): Promise<any> { let n = 0, s = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += k | 0; } s += n > 50 ? 1 : n < 0 ? 100 : 6; n++; } return n + " " + s; }
async function elementsBy(k: number): Promise<any> { const list = new Float64Array(16).fill(1.5); let n = 0, s: any = 0; for (let i = 0; i < 8; i++) { if (i === 2) { await null; n += k | 0; } s += list[n++] ?? 100; } return n + " " + s; }
function inStep(): any { let n = 0, i = 0, s = 0; outer: for (;;) { for (; i < 8; i++) { if (i === 2) { jobs[0](); n += 1000000000000; i++; continue outer; } s += n > 50 ? 1 : 10; n++; } break; } return n + " " + s; }
let hits = 0; const jobs: (() => void)[] = [() => { hits++; }];
const runs: (() => any)[] = [sums, cuts, compares, negative, elements, words, characters, keys, views, sumsByHand, elementsByHand, comparesByHand, repeats, () => stepsBy(100), () => stepsBy(-10), () => stepsBy(0), () => elementsBy(100), () => elementsBy(-10), () => elementsBy(4), inStep];
for (let round = 0; round < 4; round++) for (let r = 0; r < runs.length; r++) log(r + " " + (await runs[r]()));
console.log(out.join("\n"), hits);
