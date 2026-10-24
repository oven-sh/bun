// Many properties of one receiver that may be null or undefined are read in a large function: one test suffices.
declare const console: any;
interface Base { kind: number; flags: number; id: number; parent: Base | undefined }
interface Wide extends Base { objectFlags: number; extra: number; more: number }
function sumUp(t: Base, u: Base): number {
    let r = t.kind + t.flags + t.id;
    if (t.flags & 1) r += (t as Wide).objectFlags + (t as Wide).extra;
    if (t.flags & 2) r -= (t as Wide).more;
    r += u.kind * 3 + u.flags * 5 + u.id * 7;
    if (u.flags & 1) r += (u as Wide).objectFlags - (u as Wide).extra;
    if (t.kind > u.kind) r += t.id - u.id; else r += u.id - t.id;
    if (t.parent) r += t.parent.kind + t.parent.flags + t.parent.id;
    if (u.parent) r += u.parent.kind - u.parent.flags - u.parent.id;
    return r + t.kind + u.kind;
}
const all: Base[] = [];
let last: Base | undefined = undefined;
for (let i = 0; i < 64; i++) {
    const w: Wide = { kind: i & 7, flags: i & 3, id: i, parent: last, objectFlags: i * 2, extra: i * 3, more: i * 5 };
    all.push(w); last = w;
}
let s = 0;
for (let round = 0; round < 200000; round++) { for (let i = 0; i < 63; i++) s += sumUp(all[i], all[i + 1]); }
console.log(s);
export {};
