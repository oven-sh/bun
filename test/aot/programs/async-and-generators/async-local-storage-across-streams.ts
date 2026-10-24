// The store of an AsyncLocalStorage on both sides of every handover between async generators and async functions of the program, where somebody waits in earnest:
// next() written out and awaited by a function or by a generator in a store of its own; helpers awaited by generators; relays; two consumers in two stores that
// pull one stream in turn; a store entered in the middle. Waits are jobs (nothing else queued), jobs beside a ticker, and timers.
import { AsyncLocalStorage } from "node:async_hooks";

let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
const storage = new AsyncLocalStorage<string>();
function where(): string {
    return storage.getStore() ?? "-";
}
type Wait = () => Promise<void>;
const waits: [string, Wait][] = [
    ["jobs", () => new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); })],
    ["a timer", () => new Promise(resolve => setTimeout(resolve, 1))],
    ["jobs in a store of their own", () => storage.run("w", () => new Promise<void>(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); }))],
];
function ticker(turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => undefined);
    return last;
}
async function* source(wait: Wait, n: number): AsyncGenerator<string, string> {
    for (let i = 0; i < n; i++) {
        note("source ahead of its wait in " + where());
        await wait();
        note("source behind its wait in " + where());
        yield "s" + i + "@" + where();
        note("source behind its yield in " + where());
    }
    return "over@" + where();
}
async function pulls(from: AsyncGenerator<string, string>, label: string): Promise<void> {
    for (;;) {
        const step = await from.next();
        note(label + " got " + step.value + " in " + where());
        if (step.done) return;
    }
}
async function* pullsAndYields(from: AsyncGenerator<string, string>, label: string): AsyncGenerator<string, string> {
    for (;;) {
        const step = await from.next();
        note(label + " got " + step.value + " in " + where());
        if (step.done) return step.value + "<" + where();
        yield step.value + "<" + where();
    }
}
async function* relay(from: AsyncGenerator<string, string>, store: string | null): AsyncGenerator<string, string> {
    async function pulled(): Promise<IteratorResult<string, string>> {
        const step = await from.next();
        note("pulled() behind next() in " + where());
        return step;
    }
    while (true) {
        const step = await (store === null ? pulled() : storage.run(store, pulled));
        note("relay behind pulled() in " + where());
        if (step.done === true) return step.value;
        yield step.value;
    }
}
async function helper(wait: Wait, i: number, store: string | null): Promise<{ n: number; at: string }> {
    if (store !== null) storage.enterWith(store);
    await wait();
    note("helper behind its wait in " + where());
    return { n: i, at: where() };
}
async function* awaitsHelpers(wait: Wait, store: string | null): AsyncGenerator<string> {
    for (let i = 0; i < 2; i++) {
        const made = await helper(wait, i, store);
        note("generator behind the helper in " + where());
        yield made.n + "@" + made.at + "<" + where();
    }
}
async function* entersAStore(wait: Wait): AsyncGenerator<string> {
    await wait();
    yield "before " + where();
    storage.enterWith("entered");
    await wait();
    yield "behind " + where();
}
async function collect(from: AsyncIterable<string>, label: string): Promise<void> {
    for await (const x of from) note(label + " got " + x + " in " + where());
    note(label + " is through in " + where());
}
async function inTurn(from: AsyncGenerator<string, string>): Promise<void> {
    const one = (label: string) => storage.run(label, async () => { const step = await from.next(); note(label + " got " + step.value + " in " + where()); });
    await one("x"); await one("y"); await Promise.all([one("x"), one("y")]); await one("x");
}
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    for (const beside of [false, true]) {
        log = [];
        await (beside ? Promise.all([ticker(30), run()]) : run());
        lines.push(title + (beside ? ", beside jobs" : "") + ": " + log.join(" | ") + " | at the end " + where());
    }
}
for (const [kind, wait] of waits) {
    await scene(kind + ": a function pulls, no store", () => pulls(source(wait, 2), "f"));
    await scene(kind + ": a function pulls in a", () => storage.run("a", () => pulls(source(wait, 2), "f")));
    await scene(kind + ": made in m, pulled in a", () => { const made = storage.run("m", () => source(wait, 2)); return storage.run("a", () => pulls(made, "f")); });
    await scene(kind + ": begun in m, pulled on in a", async () => { const made = source(wait, 3); await storage.run("m", async () => { note("first " + (await made.next()).value); }); await storage.run("a", () => pulls(made, "f")); });
    await scene(kind + ": a generator pulls in a, its consumer in b", () => { const middle = storage.run("a", () => pullsAndYields(source(wait, 2), "g")); return storage.run("b", () => collect(middle, "c")); });
    await scene(kind + ": a generator pulls, pulled by a function in b", () => storage.run("b", () => pulls(pullsAndYields(source(wait, 2), "g"), "f")));
    await scene(kind + ": relayed", () => storage.run("a", () => collect(relay(source(wait, 2), null), "c")));
    await scene(kind + ": relayed, pulled() in p", () => storage.run("a", () => collect(relay(source(wait, 2), "p"), "c")));
    await scene(kind + ": relayed twice", () => storage.run("a", () => collect(relay(relay(source(wait, 2), "p"), "q"), "c")));
    await scene(kind + ": helpers", () => storage.run("a", () => collect(awaitsHelpers(wait, null), "c")));
    await scene(kind + ": helpers that enter h", () => storage.run("a", () => collect(awaitsHelpers(wait, "h"), "c")));
    await scene(kind + ": helpers, no store", () => collect(awaitsHelpers(wait, null), "c"));
    await scene(kind + ": a store entered in the middle", () => storage.run("a", () => collect(entersAStore(wait), "c")));
    await scene(kind + ": two consumers in turn", () => inTurn(source(wait, 6)));
}
console.log(lines.join("\n"));
