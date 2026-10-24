// `yield e` in an async generator awaits `e` and hands it out. However much the build knows about `e` (a counter in a range, a constant, a string, a promise, a value nobody knows),
// a step takes the same turns of the job queue, which a ticker beside the loop shows.
const order: string[] = [];
const hidden = new Function("v", "return v" + String(order.length).slice(1)) as <V>(v: V) => V;
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => void order.push(label + i));
    return last;
}
async function* counters(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) yield i;
}
async function* constants(): AsyncGenerator<number> {
    yield 1;
    yield 2;
}
async function* texts(n: number): AsyncGenerator<string> {
    for (let i = 0; i < n; i++) yield "t" + i;
}
async function* promises(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) yield Promise.resolve(i * 10);
}
async function* unknownValues(values: unknown[]): AsyncGenerator<unknown> {
    for (const value of values) yield hidden(value);
}
async function* usedAfterwards(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) {
        const sent = yield i;
        order.push("sent " + String(sent));
    }
}
async function run(label: string, source: AsyncGenerator<unknown>): Promise<void> {
    const beside = ticker(label + ".", 10);
    for await (const value of source) order.push(label + "=" + String(value));
    order.push(label + " ends");
    await beside;
}
await run("counters", counters(3));
await run("constants", constants());
await run("texts", texts(2));
await run("promises", promises(2));
await run("unknown", unknownValues([1, "two", Promise.resolve(3), { then(resolve: (value: number) => void) { resolve(4); } }]));
await run("sent", usedAfterwards(2));
const byHand = counters(2);
const beside = ticker("hand.", 8);
order.push(JSON.stringify(await byHand.next()), JSON.stringify(await byHand.next()), JSON.stringify(await byHand.next()));
await beside;
console.log(order.join("\n"));
export {};
