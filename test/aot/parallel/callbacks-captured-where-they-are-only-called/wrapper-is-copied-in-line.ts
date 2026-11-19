type Visit = (x: number) => number;

const kept: Visit[] = [];

function each(list: number[], f: Visit): number {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += f(list[i]);
    return t;
}

function small(list: number[], f: Visit): number {
    return each(list, x => f(x) + 1) + 1;
}

function smallThatKeeps(f: Visit): number {
    return kept.push(x => f(x) + 2) + 1;
}

function smallOverMethod(list: number[], f: Visit): number {
    let t = 0;
    list.forEach(x => (t += f(x)));
    return t;
}

function handsOn(list: number[], f: Visit): number {
    const a = small(list, f);
    const b = smallThatKeeps(f);
    const c = smallOverMethod(list, f);
    return a + b + c;
}

function maker(list: number[], k: number): number {
    const a = small(list, x => x * k);
    const b = smallThatKeeps(x => x + k);
    const c = smallOverMethod(list, x => x - k);
    const d = handsOn(list, x => x % (k + 1));
    return a + b + c + d;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = small([1, 2], x => x + depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

let sum = 0;
for (let i = 0; i < 500; i++) {
    sum += maker([i, i + 1, i + 2, i + 3], i);
    if (i % 100 === 99) Bun.gc(true);
}
Bun.gc(true);
console.log(overwriteStack(1500, 29));
Bun.gc(true);

let sumOfKept = 0;
for (let i = 0; i < kept.length; i++) sumOfKept += kept[i](i);
console.log(sum, kept.length, sumOfKept, new Set(kept).size);
console.log(kept[0](1), kept[1](1), kept[998](1), kept[999](1));
