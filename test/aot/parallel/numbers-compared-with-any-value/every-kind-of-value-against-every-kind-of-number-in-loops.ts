const out: string[] = [];
type Row = { id: number };
const numbers = [0, -0, 1, -1, 4, 4.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e21, 5e-324, NaN, Infinity, -Infinity];
function makeRows(): Row[] { const rows: Row[] = []; for (let i = 0; i < numbers.length; i++) rows.push({ id: numbers[i]! }); return rows; }
const others: unknown[] = [...numbers, "4", "", "NaN", true, false, null, undefined, 4n, 0n, Symbol.iterator, {}, [], [4], { valueOf() { return 4; } }, new Number(4), () => 4];
const holder = { others } as { others: unknown[] };
function hits(rows: Row[], at: number) { let n = 0; const wanted = holder.others[at]; for (let i = 0; i < rows.length; i++) if (rows[i]!.id === wanted) n++; return n; }
function misses(rows: Row[], at: number) { let n = 0; const wanted = holder.others[at]; for (let i = 0; i < rows.length; i++) if (rows[i]!.id !== wanted) n++; return n; }
function firstHit(rows: Row[], at: number) { const wanted = holder.others[at]; let i = 0; while (i < rows.length && !(wanted === rows[i]!.id)) i++; return i; }
function pairs(rows: Row[]) { let n = 0; for (let i = 0; i < rows.length; i++) for (let j = 0; j < holder.others.length; j++) if (rows[i]!.id === holder.others[j]) n += i * 100 + j; return n; }
const rows = makeRows();
for (let at = 0; at < others.length; at++) out.push([at, hits(rows, at), misses(rows, at), firstHit(rows, at)].join(" "));
out.push(String(pairs(rows)));
console.log(out.join("\n"));
