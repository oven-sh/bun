function delayed(f: (x: number) => number): (x: number) => number {
    return x => f(x) + 1;
}

function delayedWhereOdd(n: number, f: (x: number) => number): ((x: number) => number) | number {
    if (n % 2) return x => f(x) * 2;
    const t = f(n);
    return t;
}

function maker(k: number): (x: number) => number {
    const wrapped = delayed(x => x * k);
    return wrapped;
}

function makerOfEither(n: number, k: number): ((x: number) => number) | number {
    const either = delayedWhereOdd(n, x => x + k);
    return either;
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x * depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const returned: ((x: number) => number)[] = [];
const eithers: (((x: number) => number) | number)[] = [];
for (let i = 0; i < 300; i++) {
    returned.push(maker(i));
    eithers.push(makerOfEither(i, i * 3));
}
Bun.gc(true);
console.log(overwriteStack(1500, 3));
Bun.gc(true);

let sum = 0;
for (let i = 0; i < returned.length; i++) sum += returned[i](i + 1);
let sumOfEithers = 0;
for (let i = 0; i < eithers.length; i++) {
    const either = eithers[i];
    sumOfEithers += typeof either === "number" ? either : either(i);
}
console.log(sum, sumOfEithers, returned[7](2), returned[299](1));
console.log(new Set(returned).size, returned[1] === returned[1], returned[1] === returned[2], typeof eithers[0], typeof eithers[1]);
