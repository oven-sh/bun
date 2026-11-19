// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 2
// No listener is handed a promise: `then` and what is awaited out of lists and maps stay known.
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
const out = [];
process.on("exit", () => console.log(out.sort().join("\n")));
process.on("SIGUSR2", signal => out.push(signal));
async function make(x) {
    return new Point(x, 1);
}
make(1).then(point => out.push(`then ${point.x}`));
new Promise(resolve => setTimeout(() => resolve(new Point(2, 3)), 0)).then(point => out.push(`later ${point.y}`)).catch(() => {});
Promise.all([make(4), make(5)]).then(points => out.push(`all ${points.map(point => point.x)}`));
(async () => {
    const waiting = [];
    for (let turn = 0; turn < 3; turn++)
        waiting.push(make(turn));
    let sum = 0;
    for (const promise of waiting)
        sum += (await promise).x;
    out.push(`list ${sum}`);
    const held = new Map([["key", make(6)]]);
    out.push(`map ${(await held.get("key")).x}`);
})();

function run(turns) {
    let sum = new Point(0, 0);
    const step = new Point(1, 2);
    for (let turn = 0; turn < turns; turn++)
        sum = sum.add(step);
    return sum.x + sum.y;
}
out.push(run(1000));
