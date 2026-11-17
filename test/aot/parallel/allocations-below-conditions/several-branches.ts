// Lists, records and closures that only one of several conditions needs.
function concatenate<T>(first: readonly T[] | undefined, second: T): readonly T[] {
    const tail = [second];
    if (first === undefined || first.length === 0) return tail;
    return [...first, second];
}
function record(x: number, y: number): { x: number; y: number; next?: unknown } | number {
    const made = { x, y };
    if (x > 10 || y > 10 || x === y) return made;
    return x - y;
}
function closure(limit: number, seen: Set<number>): (() => number) | undefined {
    const counted = () => limit + seen.size;
    if (limit < 0 || seen.has(limit)) return counted;
    seen.add(limit);
    return undefined;
}
function inLoop(values: readonly number[], stop: number): unknown[] {
    const kept: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
        const pair = [values[i], i];
        if (values[i] === stop || i > 20) { kept.push(pair); break; }
        if (values[i] % 7 === 0 || values[i] % 5 === 0) { kept.push(pair); continue; }
        kept.push(i);
    }
    return kept;
}
function filled(a: number, b: number): number[] | string {
    const list = [a];
    list.push(b);
    if (a === b || b === 0) return list;
    return a + ":" + b;
}
function thrown(value: unknown): number {
    const error = new TypeError("no number: " + typeof value);
    if (typeof value !== "number" || value !== value) throw error;
    return value;
}
function merged(flag: number): number[] {
    const list = [flag];
    if (flag === 1 || flag === 2) list.push(9);
    return list;
}
function nested(a: number, b: number): unknown {
    const inner = { a }, outer = { inner, b };
    if (a < b || a === 5) { if (b === 3 || b === 4) return outer; return inner; }
    return b;
}
function switched(kind: number, value: string): unknown {
    const entry = { kind, value };
    switch (kind) { case 1: case 3: case 5: return entry; case 2: return value; default: return kind; }
}
const seen = new Set<number>();
for (let i = 0; i < 24; i++) {
    const list = i % 4 ? Array.from({ length: i % 3 }, (_, k) => k + i) : undefined;
    console.log(i, JSON.stringify(concatenate(list, i)), JSON.stringify(record(i, 12 - i)), closure(i % 6 - 1, seen)?.(), JSON.stringify(filled(i % 3, i % 2)), JSON.stringify(merged(i % 4)), JSON.stringify(nested(i % 6, i % 5)), JSON.stringify(switched(i % 7, "v" + i)));
    try { console.log(thrown(i % 3 ? i : i % 2 ? NaN : "x" + i)); } catch (e) { console.log(String(e)); }
}
console.log(JSON.stringify(inLoop([1, 14, 3, 10, 8, 42, 5], 42)), JSON.stringify(inLoop(Array.from({ length: 30 }, (_, i) => i + 1), -1)));
const same = concatenate(undefined, 1), other = concatenate(undefined, 1); console.log(same === other, same !== concatenate([], 1));
