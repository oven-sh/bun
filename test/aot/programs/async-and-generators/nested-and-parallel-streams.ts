// Async generators consumed inside the loops of other consumers, side by side, through yield*, by next() written out and by `for await` in turn:
// what one stream's step or end says must never show in another's.
const lines: string[] = [];
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
async function* count(label: string, n: number): AsyncGenerator<string, string> {
    for (let i = 0; i < n; i++) yield label + i;
    return label + " is over";
}
async function* countSlowly(label: string, n: number): AsyncGenerator<string> {
    for (let i = 0; i < n; i++) { if (i % 2) await outside(); yield label + i; }
}
async function* none(): AsyncGenerator<string> {}
async function* nested(depth: number): AsyncGenerator<string> {
    if (!depth) { yield "leaf"; return; }
    for await (const inner of nested(depth - 1)) { yield depth + ">" + inner; yield depth + "<" + inner; }
}
async function* delegates(): AsyncGenerator<string, string> {
    const first = yield* count("d", 2);
    yield "between: " + first;
    yield* none();
    const second = yield* count("e", 1);
    return "delegates is over behind " + second;
}
async function* zip(a: AsyncGenerator<string>, b: AsyncGenerator<string>): AsyncGenerator<string> {
    for (;;) {
        const x = await a.next();
        const y = await b.next();
        if (x.done || y.done) { yield "zip ends: " + x.done + " " + y.done + " " + x.value + " " + y.value; return; }
        yield x.value + "+" + y.value;
    }
}
async function inside(): Promise<void> {
    const seen: string[] = [];
    for await (const x of count("a", 3)) {
        for await (const y of count("b", 2)) seen.push(x + y);
        for await (const _ of none()) seen.push("never");
        seen.push(x + " goes on");
    }
    lines.push("inside: " + seen.join(" "));
}
async function insideSlow(): Promise<void> {
    const seen: string[] = [];
    for await (const x of countSlowly("a", 4)) {
        for await (const y of count("b", 2)) seen.push(x + y);
        for await (const y of countSlowly("c", 3)) seen.push(x + y);
    }
    lines.push("inside, slowly: " + seen.join(" "));
}
async function broken(): Promise<void> {
    const seen: string[] = [];
    for await (const x of count("a", 5)) {
        for await (const y of count("b", 5)) { if (y === "b1") break; seen.push(x + y); }
        if (x === "a2") break;
    }
    for await (const x of count("c", 2)) seen.push(x);
    lines.push("broken off: " + seen.join(" "));
}
async function kept(): Promise<void> {
    const steps: IteratorResult<string, string>[] = [];
    const source = count("k", 2);
    steps.push(await source.next());
    for await (const x of count("m", 2)) steps.push({ done: false, value: x });
    steps.push(await source.next());
    steps.push(await source.next());
    steps.push(await source.next());
    lines.push("kept: " + JSON.stringify(steps));
}
async function inTurn(): Promise<void> {
    const seen: string[] = [];
    const source = count("t", 6);
    seen.push(JSON.stringify(await source.next()));
    for await (const x of source) { seen.push(x); if (x === "t2") break; }
    seen.push(JSON.stringify(await source.next()));
    lines.push("in turn: " + seen.join(" "));
}
async function collect(label: string, source: AsyncIterable<string>): Promise<void> {
    const seen: string[] = [];
    for await (const x of source) seen.push(x);
    lines.push(label + ": " + seen.join(" "));
}
async function resumed(run: () => Promise<void>): Promise<void> {
    await outside();
    await run();
}
const scenes: (() => Promise<void>)[] = [
    inside, insideSlow, broken, kept, inTurn,
    () => collect("nested", nested(3)),
    () => collect("delegates", delegates()),
    () => collect("zip", zip(count("x", 3), count("y", 2))),
    () => collect("zip of slow ones", zip(countSlowly("x", 3), count("y", 4))),
    () => collect("none", none()),
];
for (const scene of scenes) await scene();
lines.push("--- resumed");
for (const scene of scenes) await resumed(scene);
lines.push("--- all at once");
await Promise.all(scenes.map(scene => scene()));
lines.push("--- all at once, resumed");
await Promise.all(scenes.map(scene => resumed(scene)));
console.log(lines.join("\n"));
