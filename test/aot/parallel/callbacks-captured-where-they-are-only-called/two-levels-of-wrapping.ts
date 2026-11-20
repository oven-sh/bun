type Visit = (x: number) => number;

const kept: Visit[] = [];

function each(list: number[], f: Visit): number {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += f(list[i]);
    return t;
}

function keepWhereLarge(limit: number, f: Visit): number {
    if (limit > 5) kept.push(x => f(x) + 1000);
    const t = f(limit);
    return t;
}

function inner(list: number[], f: Visit): number {
    const t = each(list, x => f(x) + 1);
    return t + 1;
}

function outer(list: number[], f: Visit): number {
    const t = inner(list, x => f(x) * 2);
    return t + 1;
}

function nested(list: number[], f: Visit): number {
    const t = each(list, x => {
        const s = each(list, y => f(x + y));
        return s + 1;
    });
    return t + 1;
}

function outerThatMayKeep(limit: number, f: Visit): number {
    const t = keepWhereLarge(limit, x => f(x) + 10);
    return t + 1;
}

function outermost(limit: number, f: Visit): number {
    const t = outerThatMayKeep(limit, x => f(x) + 100);
    return t + 1;
}

function maker(list: number[], k: number): number {
    const a = outer(list, x => x + k);
    const b = nested(list, x => x * k);
    const c = outermost(k % 10, x => x - k);
    return a + b + c;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = each([1, 2], x => x + depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

let sum = 0;
for (let i = 0; i < 500; i++) {
    sum += maker([i, i + 1, i + 2], i);
    if (i % 100 === 99) Bun.gc(true);
}
Bun.gc(true);
console.log(overwriteStack(1500, 9));
Bun.gc(true);

let sumOfKept = 0;
for (let i = 0; i < kept.length; i++) sumOfKept += kept[i](i);
console.log(sum, kept.length, sumOfKept, new Set(kept).size);
console.log(kept[0](0), kept[1](0), kept[kept.length - 1](0));
