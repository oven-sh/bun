// An array literal passed to a known function: read by constant and computed indices, past its end, written, kept, returned, aliased, frozen, compared, iterated and spread.
const out: string[] = [];
let keptArray: readonly unknown[] | undefined;
function ends(texts: readonly string[]): string { const last = texts.length - 1; const first = texts[0]; const end = texts[last]; if (last === 0 && first.length < 2) return "short:" + first; return first + "|" + end + "|" + last; }
function endsThenKeeps(texts: readonly string[], keep: boolean): string { const last = texts.length - 1; const end = texts[last]; if (keep) keptArray = texts; return end + texts.length; }
function pastTheEnd(a: readonly number[]): string { return String(a[a.length]) + "," + String(a[a.length + 1]) + "," + String(a[a.length - 1]) + "," + String(a[a.length - 2]); }
function beforeTheStart(a: readonly number[]): string { const i = a.length - 3; return String(a[i]); }
function sumOfIndices(a: readonly number[]): number { return a[a.length - 1 - 1 + 1] + a[0 + a.length - a.length]; }
function writes(a: number[]): string { const last = a.length - 1; a[last] = 99; a.push(7); return a[last] + "," + a[a.length - 1] + "," + a.length; }
function writesThenReadsLength(a: number[]): number { a.length = 0; return a.length - 1; }
function pops(a: number[]): string { const before = a.length; const v = a.pop(); return before + "," + v + "," + a.length + "," + String(a[a.length - 1]); }
function returnsIt<T>(a: T[]): T[] { const last = a.length - 1; if (last < 0) return []; return a; }
function same(a: unknown[], b: unknown[]): boolean { return a === b && a.length - 1 === b.length - 1; }
function frozen(a: number[]): string { Object.freeze(a); try { a[a.length - 1] = 5; } catch (e) { return "threw " + a[a.length - 1]; } return "stored " + a[a.length - 1]; }
function iterates(a: readonly number[]): number { let s = 0; for (const v of a) s += v; return s * 10 + a[a.length - 1]; }
function spreads(a: readonly number[]): string { const b = [...a, a[a.length - 1]]; return b.join("-"); }
function destructures(a: readonly [number, number]): number { const [x, y] = a; return x * 100 + y + a[a.length - 1]; }
function inner(a: readonly string[]): string { const last = a.length - 1; function at(i: number) { return i < last ? a[i] : "end:" + a[last]; } if (a[0] === "") return "empty"; return at(0) + at(last); }
function byVariable(a: readonly number[], i: number): string { return String(a[i]) + String(a[a.length - 1 - i]); }
function loops(a: readonly number[]): number { let s = 0; for (let i = a.length - 1; i >= 0; i--) s = s * 10 + a[i]; return s; }
function holes(a: (number | undefined)[]): string { return String(a[a.length - 1]) + "," + String(a[0]) + "," + a.length + "," + (0 in a); }
function lengthOnly(a: readonly unknown[]): number { return a.length - 1; }
function two(a: readonly number[], b: readonly number[]): number { return a[a.length - 1] * 10 + b[b.length - 1] + a[b.length - 1]; }
function nested(a: readonly (readonly number[])[]): number { const last = a[a.length - 1]; return last[last.length - 1]; }
function withGetter(o: { readonly list: readonly number[] }): number { const a = o.list; return a[a.length - 1]; }

for (let round = 0; round < 3; round++) {
    const s = "s" + round, n = round + 1;
    out.push("ends 1 " + ends([s]));
    out.push("ends 1 short " + ends(["x"]));
    out.push("ends 2 " + ends([s, "t"]));
    out.push("ends 3 " + ends([s, "t", "u" + round]));
    out.push("endsThenKeeps " + endsThenKeeps([s], false) + " " + (keptArray === undefined));
    out.push("endsThenKeeps kept " + endsThenKeeps([s, "k"], true) + " " + (keptArray as string[]).join("+"));
    keptArray = undefined;
    out.push("pastTheEnd " + pastTheEnd([n]) + " " + pastTheEnd([n, n + 1]) + " " + pastTheEnd([]));
    out.push("beforeTheStart " + beforeTheStart([n]) + " " + beforeTheStart([n, 2, 3]));
    out.push("sumOfIndices " + sumOfIndices([n, 5]));
    out.push("writes " + writes([n]) + " " + writes([n, 2]));
    out.push("writesThenReadsLength " + writesThenReadsLength([n, 2]));
    out.push("pops " + pops([n]) + " " + pops([n, 8]));
    { const r = returnsIt([n]); r.push(4); out.push("returnsIt " + r.join(",") + " " + returnsIt<number>([]).length); }
    { const a = [n]; out.push("same " + same(a, a) + " " + same([n], [n])); }
    out.push("frozen " + frozen([n]));
    out.push("iterates " + iterates([n, 2]));
    out.push("spreads " + spreads([n, 2]));
    out.push("destructures " + destructures([n, 2]));
    out.push("inner " + inner([s]) + " " + inner([s, "z"]) + " " + inner([""]));
    out.push("byVariable " + byVariable([n, 7], round % 2) + " " + byVariable([n], round));
    out.push("loops " + loops([n, 2, 3]));
    out.push("holes " + holes([, n]) + " " + holes([n, ,]) + " " + holes([undefined]));
    out.push("lengthOnly " + lengthOnly([n, s]) + " " + lengthOnly([]));
    out.push("two " + two([n, 2], [3]) + " " + two([n], [3, 4]));
    out.push("nested " + nested([[n], [n, 6]]));
    out.push("withGetter " + withGetter({ list: [n, 9] }));
}
console.log(out.join("\n"));
