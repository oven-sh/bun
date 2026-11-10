type Job = () => number;

const kept: Job[] = [];

function later(keeps: boolean, f: Job): number {
    if (keeps) kept.push(() => f());
    const t = f();
    return t;
}

function twice(f: Job): number {
    const t = f() + f();
    return t;
}

function throughWrapper(f: Job): number {
    const t = twice(() => f() + 1);
    return t;
}

function counter(start: number, keeps: boolean): number {
    let n = start;
    const t = later(keeps, () => ++n);
    return t * 1000 + n;
}

function counterThroughWrapper(start: number): number {
    let n = start;
    const t = throughWrapper(() => ++n);
    return t * 1000 + n;
}

const answers: number[] = [];
for (let i = 0; i < 300; i++) {
    answers.push(counter(i * 10, i % 3 === 0));
    answers.push(counterThroughWrapper(i * 10));
    if (i % 100 === 99) Bun.gc(true);
}
Bun.gc(true);

let sum = 0;
for (const answer of answers) sum += answer;
let sumOfKept = 0;
for (let round = 0; round < 3; round++) {
    for (let i = 0; i < kept.length; i++) sumOfKept += kept[i]();
    sum += counter(round, false) + counterThroughWrapper(round);
}
console.log(sum, kept.length, sumOfKept, new Set(kept).size);
console.log(kept[0](), kept[1](), kept[2](), kept[99](), kept[0](), kept[1]());
