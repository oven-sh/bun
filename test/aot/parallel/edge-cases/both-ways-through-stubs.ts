// Both ways through stubs whose usual way lies in line: keys made of two parts, parts of strings, comparisons with short texts, empty lists, tables that grow, and fields that come late.
let seed = 99;
function random(limit: number): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % limit; }
function check(value: unknown): void { sum = (sum * 31 + String(value).length + (typeof value === "number" ? value | 0 : 0)) | 0; }
let sum = 0;

const record: Record<string, number> = {};
function storeUnder(first: any, second: any): void { record[first + second] = (record[first + second] ?? 0) + 1; }
function readUnder(first: any, second: any): number { return record[first + second] ?? -1; }
const parts: any[] = [0, 1, 7, 1023, 1024, 1025, 70000, 2147483647, -1, -2147483648, 0.5, NaN, true, null, undefined, "", "a", "Ж", "long text of a key", 5n];
for (let turn = 0; turn < 3; turn++) {
    for (const first of parts) {
        storeUnder(first, "");
        for (const second of parts) {
            if (typeof first !== "bigint" && typeof second !== "bigint") {
                storeUnder(first, second);
                check(readUnder(first, second));
            }
            check(readUnder(second, ""));
        }
    }
}
console.log(Object.keys(record).length, Object.keys(record).sort().join("|").length, sum);

const flat = "the quick brown fox jumps over the lazy dog";
const wide = "быстрая лиса прыгает через ленивую собаку";
function joined(text: string, count: number): string { let result = ""; for (let i = 0; i < count; i++) result += text[i] + text.slice(i, i + 3); return result; }
const texts = [flat, wide, flat.substring(4), wide.substring(8), flat.substring(4).substring(6, 20), joined(flat, 9), joined(wide, 9), flat + wide, flat.slice(3) + flat, "", "x", "xy", "Ж"];
function partOf(text: string, from: number, to: number): string { return text.substring(from, to); }
for (let i = 0; i < texts.length; i++) {
    for (let from = 0; from < 8; from++) {
        for (let length = 0; length < 9; length++) {
            const part = partOf(texts[i], from, from + length);
            check(part);
            sum = (sum * 33 + (part.length ? part.charCodeAt(0) + part.charCodeAt(part.length - 1) : 0)) | 0;
        }
        check(partOf(texts[i], 0, texts[i].length));
        check(partOf(texts[i] + from, from, 1000));
    }
}
console.log(sum, partOf(joined(flat, 5), 1, 9), partOf(wide + flat, 3, 5), partOf(flat + "!", 0, flat.length + 1) === flat + "!");

function whichText(value: any): number {
    if (value === "a") return 1;
    if (value === "ab") return 2;
    if (value === "abc") return 3;
    if (value === "abcd") return 4;
    if (value === "abcde") return 5;
    if (value === "abcdef") return 6;
    if (value === "abcdefg") return 7;
    if (value === "abcdefgh") return 8;
    if (value === "") return 0;
    return -1;
}
const letters = "abcdefghij";
const compared: any[] = [1, null, undefined, {}, true, "Ж", "Жbcd", "abcЖ", "b", "ba", "abd", "abce", "abcdf", "bbcdefgh", "abcdefgi"];
for (let i = 0; i < 10; i++)
    compared.push(letters.slice(0, i), ("_" + letters).slice(1, i + 1), letters.slice(0, i >> 1) + letters.slice(i >> 1, i), "a".repeat(i), (wide + letters).slice(wide.length, wide.length + i));
console.log(compared.map(whichText).join(" "));

function emptyList(): any[] { return []; }
function filled(kind: number, count: number): any[] {
    const list: any[] = [];
    for (let i = 0; i < count; i++)
        list.push(kind === 0 ? i : kind === 1 ? i + 0.5 : kind === 2 ? "s" + i : kind === 3 ? { i } : i % 2 ? i : undefined);
    return list;
}
let total = 0;
for (let turn = 0; turn < 400; turn++) {
    const kind = turn < 100 ? 0 : turn < 200 ? 1 : turn < 300 ? random(5) : 2;
    const list = filled(kind, random(12));
    const other = emptyList();
    other.push(...list, turn);
    total += list.length * 3 + other.length + (typeof list[0] === "number" ? list[0] : 0);
}
console.log(total);

function keyOf(kind: number, i: number): any { return kind === 0 ? "k" + i : kind === 1 ? objects[i] : kind === 2 ? i * 3 : kind === 3 ? "key of a table that grows " + i : i + 0.25; }
const objects: object[] = [];
for (let i = 0; i < 120; i++) objects.push({ i });
let found = 0;
for (let turn = 0; turn < 60; turn++) {
    for (let kind = 0; kind < 5; kind++) {
        const map = new Map<any, any>(), set = new Set<any>();
        const size = turn < 40 ? turn : 100;
        for (let i = 0; i < size; i++) {
            map.set(keyOf(kind, i), turn % 2 ? objects[i] : i + 0.5);
            set.add(keyOf((kind + (i & 1)) % 5, i));
        }
        for (let i = 0; i < 110; i++)
            found += (map.get(keyOf(kind, i)) === (i < size ? turn % 2 ? objects[i] : i + 0.5 : undefined) ? 1 : 1000) + (set.has(keyOf((kind + (i & 1)) % 5, i)) === i < size ? 1 : 1000);
        found += map.size + set.size;
    }
}
console.log(found);

class Late { a?: any; b?: any; c?: any; d?: any; e?: any; f?: any; g?: any; h?: any; i?: any; j?: any; k?: any; constructor(readonly id: number) { } }
function give(late: Late, which: number, value: any): void {
    switch (which) {
    case 0: late.a = value; break; case 1: late.b = value; break; case 2: late.c = value; break; case 3: late.d = value; break; case 4: late.e = value; break; case 5: late.f = value; break;
    case 6: late.g = value; break; case 7: late.h = value; break; case 8: late.i = value; break; case 9: late.j = value; break; default: late.k = value; break;
    }
}
const all: Late[] = [];
for (let i = 0; i < 500; i++) {
    const late = new Late(i);
    for (let step = random(12); step > 0; step--)
        give(late, random(11), step % 3 ? "v" + step : objects[step]);
    all.push(late);
}
console.log(all.map(late => [late.a, late.b, late.c, late.d, late.e, late.f, late.g, late.h, late.i, late.j, late.k].map(value => value === undefined ? "." : typeof value === "string" ? value[1] : "o").join("")).join(" ").length, all.filter(late => late.a && late.k).length, all.filter(late => typeof late.f === "object").length);
