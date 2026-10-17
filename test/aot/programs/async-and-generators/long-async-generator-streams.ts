// Long streams: tens of thousands of turns, alone, chained, several at once, and waiting for jobs: the stack must not grow with the
// turns, whatever the collector does meanwhile.
async function* count(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) yield i;
}
async function* objects(n: number): AsyncGenerator<{ i: number }> {
    for (let i = 0; i < n; i++) yield { i };
}
async function* doubled(source: AsyncIterable<number>): AsyncGenerator<number> {
    for await (const x of source) yield x * 2;
}
function later(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => resolve()); });
}
async function* waits(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) { await later(); yield i; }
}
async function sum(source: AsyncIterable<number>): Promise<number> {
    let t = 0;
    for await (const x of source) t += x;
    return t;
}
async function sumOfObjects(source: AsyncIterable<{ i: number }>): Promise<number> {
    let t = 0;
    const kept: { i: number }[] = [];
    for await (const x of source) {
        t += x.i;
        if (x.i % 1000 === 0) kept.push(x);
    }
    return t + kept.length;
}
const n = 40000;
console.log("alone", await sum(count(n)));
console.log("objects", await sumOfObjects(objects(n)));
console.log("chained", await sum(doubled(doubled(count(n)))));
console.log("two at once", (await Promise.all([sum(count(n)), sum(count(n))])).join(" "));
console.log("two chains at once", (await Promise.all([sum(doubled(count(n))), sum(doubled(count(n)))])).join(" "));
console.log("waits", await sum(waits(n)));
console.log("a chain that waits", await sum(doubled(waits(n))));
console.log("three of a kind", (await Promise.all([sum(waits(n)), sum(doubled(count(n))), sumOfObjects(objects(n))])).join(" "));
