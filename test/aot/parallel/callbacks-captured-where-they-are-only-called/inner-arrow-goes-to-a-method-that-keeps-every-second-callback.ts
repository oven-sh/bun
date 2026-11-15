type Job = (x: number) => number;
type Runner = { run(job: Job): number };

class KeepsEverySecond {
    kept: Job[] = [];
    last: Job | undefined = undefined;
    turn = 0;
    sameAsLast = 0;
    run(job: Job): number {
        if (job === this.last) this.sameAsLast++;
        if (this.turn++ % 2) {
            this.kept.push(job);
            this.last = job;
        }
        return job(this.turn);
    }
}

class OnlyCalls {
    run(job: Job): number {
        const t = job(1) + job(2);
        return t;
    }
}

function go(bus: Runner, f: Job): number {
    const t = bus.run(x => f(x) + 1);
    return t + 1;
}

function goAnywhere(bus: any, f: Job): number {
    const t = bus.run((x: number) => f(x) + 2);
    return t + 1;
}

function maker(bus: Runner, k: number): number {
    const t = go(bus, x => x * k);
    const s = goAnywhere(bus, x => x + k);
    return t + s;
}

function twice(f: Job): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x + depth * salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const keeper = new KeepsEverySecond();
const caller = new OnlyCalls();
const ownKept: Job[] = [];
const literal: Runner = {
    run(job) {
        ownKept.push(job);
        return job(3);
    },
};
const bound: Runner = { run: keeper.run.bind(keeper) };
const behindProxy: Runner = new Proxy(keeper, {});
const runners: Runner[] = [keeper, caller, literal, keeper, bound, caller, behindProxy];

let sum = 0;
for (let i = 0; i < 700; i++) {
    sum += maker(runners[i % runners.length], i);
    if (i % 100 === 99) Bun.gc(true);
}
Bun.gc(true);
console.log(overwriteStack(1500, 5));
Bun.gc(true);

let sumOfKept = 0;
for (const job of keeper.kept) sumOfKept += job(2);
let sumOfOwn = 0;
for (const job of ownKept) sumOfOwn += job(2);
console.log(sum, keeper.turn, keeper.kept.length, keeper.sameAsLast, ownKept.length);
console.log(sumOfKept, sumOfOwn, new Set(keeper.kept).size, new Set(ownKept).size);
console.log(keeper.kept[0](10), keeper.kept[1](10), ownKept[0](10), ownKept[1](10), keeper.last === keeper.kept[keeper.kept.length - 1]);
