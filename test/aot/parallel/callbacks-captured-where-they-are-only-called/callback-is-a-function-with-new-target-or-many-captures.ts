type Visit = (x: number) => number;

const kept: Visit[] = [];

function each(list: number[], f: Visit): number {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += f(list[i]);
    return t;
}

function wrapped(list: number[], f: Visit): number {
    const t = each(list, x => f(x) + 1);
    return t + 1;
}

function keeps(f: Visit): number {
    kept.push(x => f(x) + 2);
    return kept.length;
}

function withNewTarget(list: number[], k: number): number {
    const a = wrapped(list, function (x: number): number {
        return new.target ? -1 : x * k;
    });
    const b = keeps(function (x: number): number {
        return new.target ? -1 : x + k;
    });
    return a + b;
}

function withManyCaptures(list: number[], a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number {
    const s = wrapped(list, x => x + a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10);
    const t = keeps(x => x - a - b * 2 - c * 3 - d * 4 - e * 5 - f * 6 - g * 7 - h * 8 - i * 9 - j * 10);
    return s + t;
}

function withNumbersAndObjects(list: number[], scale: number, offset: number, names: string[], table: Map<number, number>): number {
    const s = wrapped(list, x => x * scale + offset + names.length + (table.get(x) ?? 0));
    const t = keeps(x => x * scale - offset - names.length - (table.get(x) ?? 0));
    return s + t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = wrapped([1, 2], x => x + depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const table = new Map<number, number>([[1, 100], [2, 200]]);
let sum = 0;
for (let n = 0; n < 300; n++) {
    sum += withNewTarget([n, n + 1], n);
    sum += withManyCaptures([n, n + 1], n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7, n + 8, n + 9);
    sum += withNumbersAndObjects([n, 1, 2], n + 0.5, n, ["a", "b"], table);
    if (n % 100 === 99) Bun.gc(true);
}
Bun.gc(true);
console.log(overwriteStack(1500, 43));
Bun.gc(true);

let sumOfKept = 0;
for (let n = 0; n < kept.length; n++) sumOfKept += kept[n](n % 5);
console.log(sum, kept.length, sumOfKept, new Set(kept).size);
console.log(kept[0](1), kept[1](1), kept[2](1), kept[897](1), kept[898](1), kept[899](1));
