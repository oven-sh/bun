// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 2
// `new Promise(resolve => ..)`: what `resolve` is handed stays in sight, at once, later, through a field, a list or a built-in.
"use strict";
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }
}
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}
class Other {
    then(resolve) {
        resolve({ from: "then" });
    }
}
const out = [];
async function ask(name, make) {
    try {
        const value = await make();
        out.push(`${name} ${value === undefined ? "undefined" : typeof value === "object" && value ? `${value.x},${value.y},${value.from}` : String(value)}`);
    } catch (error) {
        out.push(`${name} rejects ${error && error.message}`);
    }
}
async function askAll() {
    const now = await new Promise(resolve => resolve(new Point(1, 2)));
    const later = await new Promise(resolve => setTimeout(() => resolve(new Point(now.x, 3)), 0));
    out.push(later.x + later.y);
    const waiting = [];
    const listed = new Promise(resolve => waiting.push(resolve));
    waiting.shift()({ x: 4, y: 5 });
    out.push((await listed).y);
}
const kept = [];
let last;
const work = [
    ask("field", () => {
        const deferred = new Deferred();
        setTimeout(() => deferred.resolve({ x: 6, y: 7 }), 0);
        return deferred.promise;
    }),
    ask("rejected", () => {
        const deferred = new Deferred();
        deferred.reject(new Error("refused"));
        deferred.resolve({ x: 1 });
        return deferred.promise;
    }),
    ask("twice", () => new Promise(resolve => {
        resolve({ x: 1 });
        resolve({ x: 2 });
    })),
    ask("thrown", () => new Promise(resolve => {
        if (kept.length < 9)
            throw new Error("thrown");
        resolve(1);
    })),
    ask("settled, then thrown", () => new Promise(resolve => {
        resolve("first");
        throw new Error("late");
    })),
    ask("timer", () => new Promise(resolve => setTimeout(resolve, 0, { x: 8, y: 9 }))),
    ask("nothing", () => new Promise(resolve => resolve())),
    ask("promise", () => new Promise(resolve => resolve(new Promise(inner => inner({ x: 10 }))))),
    ask("thenable", () => new Promise(resolve => resolve(new Other()))),
    ask("reaction", () => new Promise(resolve => Promise.resolve({ y: 11 }).then(resolve))),
    ask("spread", () => new Promise(resolve => resolve(...[{ x: 12 }, 1]))),
    ask("call", () => new Promise(resolve => resolve.call(null, { x: 13 }))),
    ask("bound", () => new Promise(resolve => setTimeout(resolve.bind(null, { x: 14 }), 0))),
    ask("two functions", () => {
        const promise = new Promise(resolve => { last = resolve; });
        const second = new Promise(resolve => {
            if (kept.length > 9)
                last = resolve;
            resolve({ x: 15 });
        });
        last({ x: 16 });
        return Promise.all([promise, second]).then(([a, b]) => `${a.x},${b.x}`);
    }),
    ask("heir", () => new (class extends Promise {})(resolve => resolve({ x: 17 }))),
    ask("shape", () => {
        let found;
        new Promise(resolve => { found = resolve; });
        found.tag = 18;
        return `${typeof found},${found.length},${found.tag},${"prototype" in found},${found(1)}`;
    }),
    askAll(),
];

function run(turns) {
    let sum = new Point(0, 0);
    const step = new Point(1, 2);
    for (let turn = 0; turn < turns; turn++)
        sum = sum.add(step);
    return sum.x + sum.y;
}
out.push(run(1000));
Promise.all(work).then(() => console.log(out.sort().join("\n")));
