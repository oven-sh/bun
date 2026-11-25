const kept: (() => number)[] = [];

function later(f: () => number): number {
    kept.push(() => f() + 1);
    return kept.length;
}

function maker(k: number): number {
    let calls = 0;
    const t = later(() => {
        calls++;
        return k * 10 + calls;
    });
    return t + calls;
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x + depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const made: number[] = [];
for (let i = 0; i < 400; i++) made.push(maker(i));
Bun.gc(true);
console.log(overwriteStack(1500, 7));
Bun.gc(true);

let sum = 0;
for (let round = 0; round < 3; round++) {
    for (let i = 0; i < kept.length; i++) sum += kept[i]();
}
console.log(made[0], made[399], kept.length, sum);
console.log(kept[0](), kept[0](), kept[1](), kept[399]());

const weights = new WeakMap<() => number, number>();
for (let i = 0; i < kept.length; i++) weights.set(kept[i], i);
let right = 0;
for (let i = 0; i < kept.length; i++) right += weights.get(kept[i]) === i ? 1 : 0;
console.log(new Set(kept).size, right, kept[3] === kept[3], kept[3] === kept[4]);
