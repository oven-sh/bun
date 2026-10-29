// Strings are built in loops. What they are on the way is kept, used as keys, compared and cut, pieces throw, and builders nest.
let seed = 7;
function random(n: number): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; }
function hash(s: string): number { let h = s.length; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
const long8 = "abcdefghij".repeat(40), long16 = "中文xy".repeat(50);
class Thrower { constructor(public when: number) {} toString(): string { if (this.when-- <= 0) throw new RangeError("piece"); return "<t>"; } }
function piece(kind: number, i: number): unknown {
    switch (kind % 14) {
    case 0: return "a";
    case 1: return i;
    case 2: return i * 1000003;
    case 3: return -i - 0.5;
    case 4: return "xyz" + i;
    case 5: return long8.slice(i % 30, i % 30 + 1 + (i % 90));
    case 6: return long8;
    case 7: return "é";
    case 8: return i % 97 === 0 ? "中" : "q";
    case 9: return null;
    case 10: return undefined;
    case 11: return i % 2 === 0;
    case 12: return i % 211 === 0 ? long16.slice(1, 9) : "";
    default: return String.fromCharCode(48 + (i % 70));
    }
}
function kept(n: number, kinds: number): number {
    const all: string[] = []; let s = "";
    for (let i = 0; i < n; i++) { s += piece(random(kinds), i); if (i % 3 === 0) all.push(s); }
    let h = hash(s);
    for (const x of all) h = (Math.imul(h, 17) + hash(x)) | 0;
    return h;
}
function keys(n: number): number {
    const o: Record<string, number> = {}; let s = "k";
    for (let i = 0; i < n; i++) { s += i % 10; o[s] = i; if (i % 16 === 15) s = "k" + i; }
    let h = 0; for (const k in o) h = (Math.imul(h, 13) + hash(k) + o[k]) | 0;
    return h;
}
function throwing(n: number, at: number): string {
    let s = "start"; const t = new Thrower(at); const seen: string[] = [];
    for (let i = 0; i < n; i++) {
        try { s += "[" + i + t + "]"; } catch (e) { s += "!" + (e as Error).message; }
        seen.push(s);
    }
    return hash(s) + ":" + hash(seen.join("|"));
}
function nested(depth: number, n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) { s += depth; if (depth > 0 && i % 2 === 0) s += "(" + nested(depth - 1, n - 1) + ")"; }
    return s;
}
function template(n: number): number {
    let h = 0; let s = "";
    for (let i = 0; i < n; i++) { const t = `${i}:${s.length}/${piece(i, i)}-${i * 0.25}`; s = i % 7 === 0 ? t : s + t; h = (h + hash(t) + hash(s)) | 0; }
    return h;
}
function cut(n: number): number {
    let s = "", h = 0;
    for (let i = 0; i < n; i++) { s += piece(i, i); if (s.length > 150) { const head = s.slice(0, 20), tail = s.slice(-20); h = (h + hash(head) + hash(tail)) | 0; s = s.slice(100); } if (i % 5 === 0) h = (h + hash(s.toUpperCase())) | 0; }
    return h + hash(s);
}
function edges(): number {
    let h = 0;
    for (let target = 100; target < 160; target++) {
        for (const last of [1, 12, 123456789, -1.5, 4294967295, 1e21, "ab", "中", long8.slice(0, 17), true, null]) {
            let s = ""; while (s.length < target) s += "x";
            const before = s; s += last; s += "|"; s += last;
            h = (Math.imul(h, 7) + hash(s) + hash(before)) | 0;
        }
    }
    return h;
}
function joined(n: number): number {
    const parts: string[] = []; let s = "";
    for (let i = 0; i < n; i++) { s += "p" + i; parts.push(s + ","); if (i % 4 === 0) s = parts[parts.length - 1] + s; if (s.length > 4000) s = ""; }
    return hash(parts.join(""));
}
for (const n of [1, 5, 40, 130, 600, 4000]) console.log(n, kept(n, 5), kept(n, 9), kept(n, 14), keys(n), template(n), cut(n), joined(n));
for (const at of [0, 1, 3, 50]) console.log(at, throwing(60, at));
console.log(hash(nested(4, 5)), hash(nested(2, 9)), edges());
Bun.gc(true);
console.log(kept(3000, 14), keys(3000), edges());
