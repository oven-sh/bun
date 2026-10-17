// next() written out on async generators that wait for something before they yield: who awaits the promise that next() handed back:
// an async function, an async generator, a then() callback, two of them, nobody yet, nobody ever; one request at a time and several at once;
// numbers, records and thenables yielded; the step objects are kept and compared: each step is an object of its own.
let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
const thenable = { then(resolve: (value: string) => void): void { note("then is called"); resolve("from then"); } };
type Source = AsyncGenerator<unknown, unknown>;
const sources: [string, () => Source][] = [
    ["numbers", async function* () { for (let i = 0; i < 3; i++) { await outside(); note("yields " + i); yield i; } return "over"; }],
    ["records", async function* () { for (let i = 0; i < 3; i++) { await outside(); note("yields " + i); yield { n: i }; } return { last: true }; }],
    ["a thenable among them", async function* () { await outside(); yield 1; await outside(); yield thenable; await outside(); yield 3; }],
    ["two yields a wait", async function* () { for (let i = 0; i < 2; i++) { await outside(); yield "a" + i; yield "b" + i; } }],
    ["no wait", async function* () { yield 1; yield 2; }],
    ["a job queued ahead of the yield", async function* () { for (let i = 0; i < 2; i++) { await outside(); Promise.resolve().then(() => note("the source's job " + i)); yield i; } }],
    ["it throws", async function* () { await outside(); yield 1; await outside(); throw new Error("thrown by the source"); }],
    ["through yield*", async function* () { yield* (async function* () { await outside(); yield "inner"; await outside(); return "inner is over"; })(); yield "outer"; }],
];
function show(step: IteratorResult<unknown, unknown>): string {
    return (step.done ? "done " : "step ") + JSON.stringify(step.value) + " " + Object.keys(step).join(",");
}
const kept: object[] = [];
function keep(step: IteratorResult<unknown, unknown>): IteratorResult<unknown, unknown> {
    if (kept.includes(step)) note("THE SAME OBJECT TWICE");
    kept.push(step);
    return step;
}
async function byFunction(source: Source): Promise<void> {
    try {
        for (;;) { const step = keep(await source.next()); note(show(step)); if (step.done) return; }
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function* byGenerator(source: Source): AsyncGenerator<string> {
    try {
        for (;;) { const step = keep(await source.next()); yield show(step); if (step.done) return; }
    } catch (error) {
        yield "caught " + (error as Error).message;
    }
}
async function* relayed(source: Source): AsyncGenerator<unknown, unknown> {
    async function pulled(): Promise<IteratorResult<unknown, unknown>> {
        try { return await source.next(); } catch (error) { note("pulled caught"); throw error; }
    }
    while (true) {
        const step = keep(await pulled());
        if (step.done === true) return step.value;
        yield step.value;
    }
}
function byThen(source: Source): Promise<void> {
    return new Promise(resolve => {
        const pull = (): void => { source.next().then(step => { note(show(keep(step))); if (step.done) resolve(); else pull(); }, error => { note("then caught " + error.message); resolve(); }); };
        pull();
    });
}
async function collect(source: AsyncIterable<unknown>): Promise<void> {
    try {
        for await (const x of source) note("got " + JSON.stringify(x));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function severalAtOnce(source: Source): Promise<void> {
    const steps = await Promise.allSettled([source.next(), source.next(), source.next(), source.next(), source.next()]);
    for (const step of steps) note(step.status === "fulfilled" ? show(keep(step.value)) : "rejected " + step.reason.message);
}
async function awaitedLater(source: Source): Promise<void> {
    const first = source.next();
    for (let i = 0; i < 6; i++) await outside();
    note("now awaited");
    try { note(show(keep(await first))); } catch (error) { note("caught " + (error as Error).message); }
    await byFunction(source);
}
async function awaitedByTwo(source: Source): Promise<void> {
    const first = source.next();
    const both = await Promise.allSettled([(async () => show(await first))(), (async () => show(await first))()]);
    for (const one of both) note(one.status === "fulfilled" ? one.value : "rejected");
    note("one object for both: " + ((await first) === (await first)));
    await byFunction(source);
}
async function neverAwaited(source: Source): Promise<void> {
    source.next().catch(() => undefined); source.next().catch(() => undefined);
    for (let i = 0; i < 8; i++) await outside();
    await byFunction(source);
}
async function* yieldsWhatNextHandsBack(source: Source): AsyncGenerator<IteratorResult<unknown, unknown>> {
    for (let i = 0; i < 5; i++) yield source.next();
}
async function* returnsWhatNextHandsBack(source: Source): AsyncGenerator<never, IteratorResult<unknown, unknown>> {
    return source.next();
}
async function yielded(source: Source): Promise<void> {
    try {
        for await (const step of yieldsWhatNextHandsBack(source)) note(show(keep(step)));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function returned(source: Source): Promise<void> {
    try {
        const last = await returnsWhatNextHandsBack(source).next();
        note("returned " + last.done + " " + show(keep(last.value)));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
    await byFunction(source);
}
const ways: [string, (source: Source) => Promise<void>][] = [
    ["the promise is yielded", yielded],
    ["the promise is returned", returned],
    ["an async function awaits", byFunction],
    ["an async generator awaits", source => collect(byGenerator(source))],
    ["relayed", source => collect(relayed(source))],
    ["relayed twice", source => collect(relayed(relayed(source)))],
    ["then", byThen],
    ["several at once", severalAtOnce],
    ["awaited later", awaitedLater],
    ["awaited by two", awaitedByTwo],
    ["never awaited", neverAwaited],
];
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = []; kept.length = 0;
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [way, go] of ways) {
    for (const [kind, make] of sources) {
        await scene(way + ", " + kind + ", alone", () => go(make()));
        await scene(way + ", " + kind + ", beside jobs", () => Promise.all([ticker("t", 20), go(make())]));
        await scene(way + ", " + kind + ", two at once", () => Promise.all([go(make()), go(make())]));
    }
}
console.log(lines.join("\n"));
