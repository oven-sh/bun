// Long streams pulled by next() written out: every step is an object of its own that the program may keep: some are kept for the whole run and read at the end,
// while the rest become garbage; numbers, texts and records are yielded; the puller is an async function, an async generator, or a relay with an async function inside;
// one stream, two side by side, and one whose steps are asked for ahead of their awaiting.
interface Chunk { n: number; text: string; }
async function* numbers(n: number): AsyncGenerator<number, string> { for (let i = 0; i < n; i++) yield i; return "numbers are over"; }
async function* texts(n: number): AsyncGenerator<string, string> { for (let i = 0; i < n; i++) yield "t" + i; return "texts are over"; }
async function* chunks(n: number): AsyncGenerator<Chunk, string> { for (let i = 0; i < n; i++) yield { n: i, text: "c" + i }; return "chunks are over"; }
async function* sometimesWaits(n: number): AsyncGenerator<number, string> {
    for (let i = 0; i < n; i++) { if (i % 7 === 3) await Promise.resolve().then(() => undefined); yield i; }
    return "over";
}
function weigh(value: unknown): number {
    return typeof value === "number" ? value : typeof value === "string" ? value.length : (value as Chunk).n + (value as Chunk).text.length;
}
async function byFunction<T>(source: AsyncGenerator<T, string>, kept: IteratorResult<T, string>[]): Promise<string> {
    let total = 0, steps = 0;
    for (;;) {
        const step = await source.next();
        if (steps++ % 97 === 0 || step.done) kept.push(step);
        if (step.done) return steps + " steps, " + total + ", " + step.value;
        total += weigh(step.value);
    }
}
async function* byGenerator<T>(source: AsyncGenerator<T, string>, kept: IteratorResult<T, string>[]): AsyncGenerator<T, string> {
    let steps = 0;
    for (;;) {
        const step = await source.next();
        if (steps++ % 97 === 0 || step.done) kept.push(step);
        if (step.done) return step.value;
        yield step.value;
    }
}
async function* relay<T>(source: AsyncGenerator<T, string>): AsyncGenerator<T, string> {
    const pulled = async (): Promise<IteratorResult<T, string>> => { try { return await source.next(); } catch (error) { throw error; } };
    while (true) {
        const step = await pulled();
        if (step.done === true) return step.value;
        yield step.value;
    }
}
async function ahead<T>(source: AsyncGenerator<T, string>, kept: IteratorResult<T, string>[]): Promise<string> {
    let total = 0, steps = 0;
    let coming = source.next();
    for (;;) {
        const next = source.next();
        const step = await coming;
        coming = next;
        if (steps++ % 97 === 0 || step.done) kept.push(step);
        if (step.done) return steps + " steps, " + total + ", " + step.value;
        total += weigh(step.value);
    }
}
function told<T>(kept: IteratorResult<T, string>[]): string {
    let total = 0;
    for (const step of kept) total += step.done ? 1000000 : weigh(step.value);
    return kept.length + " kept, " + new Set(kept).size + " different, " + total + ", keys " + Object.keys(kept[0]).join();
}
const lines: string[] = [];
async function scene<T>(title: string, run: (kept: IteratorResult<T, string>[]) => Promise<string>): Promise<void> {
    const kept: IteratorResult<T, string>[] = [];
    lines.push(title + ": " + await run(kept) + " | " + told(kept));
}
const n = 6000;
await scene<number>("numbers by a function", kept => byFunction(numbers(n), kept));
await scene<string>("texts by a function", kept => byFunction(texts(n), kept));
await scene<Chunk>("records by a function", kept => byFunction(chunks(n), kept));
await scene<number>("a stream that sometimes waits", kept => byFunction(sometimesWaits(n), kept));
await scene<Chunk>("records by a generator by a function", kept => byFunction(byGenerator(chunks(n), kept), kept));
await scene<Chunk>("records relayed twice", kept => byFunction(relay(relay(chunks(n))), kept));
await scene<number>("sometimes waits, relayed", kept => byFunction(relay(sometimesWaits(n)), kept));
await scene<string>("asked for ahead", kept => ahead(texts(n), kept));
await scene<number>("asked for ahead, sometimes waits", kept => ahead(sometimesWaits(n), kept));
await scene<Chunk>("two side by side", async kept => (await Promise.all([byFunction(chunks(n), kept), byFunction(relay(chunks(n)), kept)])).join(" & "));
await scene<number>("three kinds side by side", async kept => (await Promise.all([byFunction(numbers(n), kept), byFunction(sometimesWaits(n), kept), ahead(numbers(n), kept)])).join(" & "));
console.log(lines.join("\n"));
