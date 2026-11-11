const out: string[] = [];
function lengthOf(list: readonly unknown[] | undefined): number { return list === undefined ? 0 : list.length; }
function sizeOf(mark: { size: number }): number { return mark.size; }
const addSize = (sum: number, mark: { size: number }) => sum + sizeOf(mark);
function nameOf(prefix: string | undefined): string { return prefix + "!"; }
const pairOf = (first: unknown, prefix: string | undefined) => [first, nameOf(prefix)];
function keyed(box: any, key: any, mark: { size: number }) { const size = sizeOf(mark); return box[key] + size; }
function stored(box: any, key: any, value: unknown, mark: { size: number }) { const size = sizeOf(mark); box[key] = value; return size; }
(globalThis as any).kept = [lengthOf, sizeOf, addSize, nameOf, pairOf, keyed, stored];
(kept => {
    const [lengthOf, , addSize, , pairOf, keyed, stored] = kept;
    const withGetter = { get length() { return 41; } };
    for (const list of [undefined, [], [1, 2, 3], "four", new Uint8Array(5), withGetter, { length: "six" }, Object.create(withGetter), function (a: unknown, b: unknown) { return [a, b]; }])
        out.push(String(lengthOf(list)));
    for (const sum of [1, 1.5, -0, 2 ** 31, NaN, "text", 10n, null, undefined, { valueOf() { return 7; } }, [8]]) {
        try { out.push(String(addSize(sum, { size: 2 }))); } catch (error) { out.push((error as Error).name); }
    }
    for (const first of [1, "a", null, undefined, { a: 1 }, [2], 3.5])
        out.push(JSON.stringify(pairOf(first, first === null ? undefined : "p")));
    const box: any = { a: 1, 7: 2, [Symbol.for("s")]: 3 };
    for (const key of ["a", 7, "7", Symbol.for("s"), "missing", { toString() { return "a"; } }])
        out.push(String(keyed(box, key, { size: 100 })));
    for (const key of ["b", 8, Symbol.for("t"), { toString() { return "c"; } }])
        out.push(String(stored(box, key, String(key.toString()), { size: 5 })));
    out.push(JSON.stringify(box), String(box[Symbol.for("t")]));
})((globalThis as any).kept);
console.log(out.join("\n"));
