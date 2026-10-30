// Lists that a loop fills by index from nothing, and every way that something could see their length on the way.
const out: string[] = [];
const state: { words: number[]; seen: number[] } = { words: [], seen: [] };
const show = (label: string, value: unknown) => out.push(`${label}: ${JSON.stringify(value)}`);
function plain(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) list[k] = k * 3; return list; }
function kept(seed: number): number { const words: number[] = (state.words = new Array()); for (let k = 0; k < 16; k++) words[k] = (seed + k * 40503) | 0; return words.length; }
function fractions(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) list[k] = k / 2; return list; }
function nans(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) list[k] = k === 1 ? NaN : k; return list; }
function objects(n: number): unknown[] { const list: unknown[] = []; for (let k = 0; k < n; k++) list[k] = { k }; return list; }
function strings(n: number): string[] { const list: string[] = []; for (let k = 0; k < n; k++) list[k] = "s" + k; return list; }
function mixed(n: number): unknown[] { const list: unknown[] = []; for (let k = 0; k < n; k++) list[k] = k % 2 ? "o" : k; return list; }
function stops(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) { if (k === 2) break; list[k] = k; } return list; }
function skips(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) { if (k === 1) continue; list[k] = k; } return list; }
function throwing(n: number, f: (k: number) => number): number[] { const list: number[] = (state.seen = []); try { for (let k = 0; k < n; k++) list[k] = f(k); } catch {} return list; }
function seesLength(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) list[k] = list.length; return list; }
function seesElement(n: number): (number | undefined)[] { const list: (number | undefined)[] = []; for (let k = 0; k < n; k++) list[k] = list[k + 1] ?? k; return list; }
function seenByCall(n: number): number[] { const list: number[] = (state.seen = []); for (let k = 0; k < n; k++) list[k] = state.seen.length; return list; }
function negative(n: number): number[] { const list: number[] = []; for (let k = 0; k < n - 5; k++) list[k] = k; return list; }
function fromOne(n: number): number[] { const list: number[] = []; for (let k = 1; k < n; k++) list[k] = k; return list; }
function twoLoops(n: number): number[] { const list: number[] = []; for (let k = 0; k < n; k++) list[k] = 1; for (let k = 0; k < n; k++) list[k + n] = 2; return list; }
function inOuter(n: number): number[][] { const rows: number[][] = []; for (let r = 0; r < 2; r++) { const row: number[] = []; for (let c = 0; c < n; c++) row[c] = r + c; rows.push(row); } return rows; }
for (const n of [0, 1, 3, 17]) show("each " + n, [plain(n), fractions(n), nans(n), objects(n).length, strings(n), mixed(n), stops(n), skips(n), seesLength(n), seesElement(n), seenByCall(n), negative(n), fromOne(n), twoLoops(n), inOuter(n)]);
show("kept", [kept(5), state.words]);
show("throws", [throwing(4, k => { if (k === 2) throw 1; return k; }), state.seen]);
show("large", plain(70000).length + plain(70000)[69999]!);
let sum = 0; for (let i = 0; i < 100000; i++) { sum += plain(i & 3).length + kept(i) ; } show("sum", sum);
console.log(out.join("\n"));
