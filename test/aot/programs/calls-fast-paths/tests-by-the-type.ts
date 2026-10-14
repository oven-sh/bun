// A value that has been used as a receiver is known not to be null or undefined in later truth tests, comparisons, casts, stores and arguments.
declare const console: any;
interface Base { kind: number; flags: number; parent: Base | undefined }
interface Wide extends Base { extra: number }
const holder: { kept: Base | undefined } = { kept: undefined };
function work(t: Base, u: Base): number {
    let x = t.kind + u.kind;
    if (t) x += 1; if (u) x += 2;
    if (t == null) x += 100; if (u === undefined) x += 200;
    x += (t as Wide).extra + (u as Wide).extra;
    holder.kept = t; holder.kept = u;
    x += t!.flags + u!.flags;
    return x + (t?.kind ?? 0) + (u?.kind ?? 0);
}
const all: Wide[] = [];
for (let i = 0; i < 64; i++) all.push({ kind: i, flags: i * 2, parent: undefined, extra: i * 3 });
let s = 0;
for (let round = 0; round < 100000; round++) { for (let i = 0; i < 63; i++) s += work(all[i], all[i + 1]); }
console.log(s);
export {};
