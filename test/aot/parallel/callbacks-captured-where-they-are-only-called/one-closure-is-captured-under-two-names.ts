type Job = () => number;

const kept: Job[] = [];
let calls = 0;

function both(depth: number, f: Job, g: Job): number {
    if (!depth) {
        kept.push(() => f() + g());
        return 1;
    }
    const t = again(depth, () => f() + g());
    return t + 1;
}

function again(depth: number, h: Job): number {
    const t = both(depth - 1, h, h);
    return t + 1;
}

function maker(depth: number, k: number): number {
    const t = again(depth + 1, () => {
        calls++;
        return k;
    });
    return t + 1;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = maker(1, depth);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

console.log(maker(0, 1), maker(1, 1), maker(4, 3), maker(40, 0));
const keptByMakers = kept.length;
Bun.gc(true);
console.log(overwriteStack(1000, 41));
Bun.gc(true);
calls = 0;
console.log(kept[0](), calls);
calls = 0;
console.log(kept[1](), calls);
calls = 0;
console.log(kept[2](), calls);
console.log(keptByMakers, kept.length, new Set(kept).size);
