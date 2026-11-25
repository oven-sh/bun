type Next = (x: number) => number;

const kept: Next[] = [];

function descend(depth: number, keeps: boolean, f: Next): number {
    if (!depth) {
        if (keeps) kept.push(x => f(x) + 1);
        const t = f(0);
        return t;
    }
    const t = descend(depth - 1, keeps, x => f(x + 1) + depth);
    return t + 1;
}

function maker(depth: number, keeps: boolean, k: number): number {
    const t = descend(depth, keeps, x => x * k);
    return t + 1;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = maker(2, false, depth);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

console.log(maker(0, true, 3), maker(1, true, 3), maker(5, true, 3), maker(5, false, 3));
console.log(maker(3000, false, 2), maker(3000, true, 2), maker(3000, true, 5));
Bun.gc(true);
console.log(overwriteStack(3000, 37));
Bun.gc(true);
console.log(kept.length, kept[0](1), kept[1](1), kept[2](1), kept[3](1), kept[4](1));
console.log(kept[3](7), kept[4](7), new Set(kept).size);
