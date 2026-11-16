function steps(count: number, f: (x: number) => number): Generator<number, void, unknown> {
    return (function* () {
        for (let i = 0; i < count; i++) yield f(i);
    })();
}

function* direct(count: number, f: (x: number) => number): Generator<number, void, unknown> {
    for (let i = 0; i < count; i++) yield f(i) + 1;
}

function sumOf(make: () => Iterable<number>): number {
    let t = 0;
    for (const x of make()) t += x;
    return t;
}

function summed(count: number, f: (x: number) => number): number {
    const t = sumOf(function* () {
        for (let i = 0; i < count; i++) yield f(i) * 2;
    });
    return t + 1;
}

function maker(k: number): [Generator<number, void, unknown>, Generator<number, void, unknown>, number] {
    const a = steps(4, x => x * k);
    const b = direct(4, x => x + k);
    const c = summed(4, x => x - k);
    return [a, b, c];
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x * depth - salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const made: [Generator<number, void, unknown>, Generator<number, void, unknown>, number][] = [];
for (let i = 0; i < 200; i++) made.push(maker(i));
for (let i = 0; i < 200; i += 2) made[i][0].next();
Bun.gc(true);
console.log(overwriteStack(1500, 13));
Bun.gc(true);

let sum = 0;
for (const [a, b, c] of made) {
    for (const x of a) sum += x;
    for (const x of b) sum += x;
    sum += c;
}
console.log(sum, made[3][0].next().done, made[3][2], made[199][2]);
