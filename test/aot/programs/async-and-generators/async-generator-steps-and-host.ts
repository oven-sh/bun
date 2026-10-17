// `for await` over async generators of the program, and what the host sees of it: streams that wait for timers and then yield in bursts, through chains;
// the store of an AsyncLocalStorage in producer and consumer; next ticks and timers between the steps; rejections nobody handles; the stacks of errors made in a producer.
import { AsyncLocalStorage } from "node:async_hooks";

const log: string[] = [];
function note(text: string): void {
    log.push(text);
}
const storage = new AsyncLocalStorage<string>();
function where(): string {
    return storage.getStore() ?? "-";
}
function later(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 1));
}
function names(error: unknown): string {
    const frames: string[] = [];
    for (const line of ((error as Error).stack ?? "").split("\n")) {
        const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
        if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + frame[3]);
    }
    return frames.join(" < ");
}

async function* bursts(chunks: number, each: number): AsyncGenerator<number> {
    for (let c = 0; c < chunks; c++) {
        await later();
        note("a chunk has come");
        for (let i = 0; i < each; i++) yield c * 10 + i;
    }
}
async function* lines(source: AsyncIterable<number>): AsyncGenerator<string> {
    for await (const x of source) yield "line " + x;
}
async function* events(source: AsyncIterable<string>): AsyncGenerator<{ text: string }> {
    for await (const text of source) { if (!text.endsWith("1")) yield { text }; }
}
async function streams(): Promise<void> {
    for await (const event of events(lines(bursts(3, 3)))) {
        note("got " + event.text);
        if (event.text === "line 10") {
            process.nextTick(() => note("a tick"));
            queueMicrotask(() => note("a job"));
            setTimeout(() => note("a timer"), 0);
        }
        if (event.text === "line 0") process.nextTick(() => note("a tick alone"));
        if (event.text === "line 20") setTimeout(() => note("a timer alone"), 0);
    }
    note("the stream has ended");
}

async function* tellsStore(label: string, n: number): AsyncGenerator<string> {
    for (let i = 0; i < n; i++) { yield label + i + " in " + where(); if (i === 1) await later(); }
}
async function* entersStore(): AsyncGenerator<string> {
    yield "before " + where();
    storage.enterWith("entered");
    yield "behind " + where();
    await null;
    yield "later " + where();
}
async function stores(): Promise<void> {
    const madeOutside = tellsStore("outside", 4);
    await storage.run("a", async () => {
        for await (const text of madeOutside) note(text + ", consumer in " + where());
        for await (const text of tellsStore("inside", 4)) note(text + ", consumer in " + where());
        for await (const text of lines2(tellsStore("chained", 3))) note(text + ", consumer in " + where());
    });
    await storage.run("b", async () => {
        for await (const text of entersStore()) note(text + ", consumer in " + where());
        note("behind the loop " + where());
    });
    note("at the end " + where());
}
async function* lines2(source: AsyncIterable<string>): AsyncGenerator<string> {
    for await (const text of source) yield text + " through " + where();
}

const unhandled: string[] = [];
process.on("unhandledRejection", (reason: unknown) => { unhandled.push((reason as Error).message); });
async function* fails(text: string, late: boolean): AsyncGenerator<number> {
    yield 1;
    if (late) await later();
    throw new Error(text);
}
async function drains(source: AsyncIterable<number>): Promise<number> {
    let n = 0;
    for await (const x of source) n += x;
    return n;
}
async function rejections(): Promise<void> {
    try { await drains(fails("one", false)); } catch (error) { note("caught " + (error as Error).message); }
    try { await drains(fails("two", true)); } catch (error) { note("caught " + (error as Error).message); }
    await later();
    note("unhandled so far: " + unhandled.join());
    drains(fails("three", false));
    drains(fails("four", true));
    fails("five", false).next();
    const g = fails("six", false);
    g.next();
    g.next();
    await later();
    await later();
    await later();
    note("unhandled: " + unhandled.slice().sort().join());
}

async function* makesErrors(): AsyncGenerator<Error> {
    yield new Error("first");
    yield new Error("second");
    await later();
    yield new Error("behind a timer");
    yield new Error("last");
}
async function* passesErrors(): AsyncGenerator<Error> {
    for await (const error of makesErrors()) yield error;
}
async function stacks(): Promise<void> {
    for await (const error of makesErrors()) note(error.message + ": " + names(error));
    await null;
    for await (const error of passesErrors()) note(error.message + ": " + names(error));
}

await streams();
await stores();
await rejections();
await stacks();
console.log(log.join("\n"));
