// Async generators that await async functions of the program: functions that return at once, behind a settled await, behind an await that waits in earnest,
// that throw; numbers, texts, records, thenables; one waiter, a generator and a function waiting for one promise, a promise nobody waits for yet;
// alone and beside other jobs, with a ticker that shows every turn of the job queue.
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
interface Chunk { n: number; }
const thenable = { then(resolve: (value: string) => void): void { note("then is called"); resolve("from then"); } };
type Helper = (i: number) => Promise<unknown>;
const helpers: [string, Helper][] = [
    ["at once, a number", async i => i],
    ["at once, a record", async i => ({ n: i } as Chunk)],
    ["behind a settled await, a number", async i => { await undefined; note("helper returns"); return i; }],
    ["behind a settled await, a record", async i => { await undefined; note("helper returns"); return { n: i } as Chunk; }],
    ["behind a wait, a number", async i => { await outside(); note("helper returns"); return i; }],
    ["behind a wait, a text", async i => { await outside(); note("helper returns"); return "text " + i; }],
    ["behind a wait, a record", async i => { await outside(); note("helper returns"); return { n: i } as Chunk; }],
    ["behind a wait, undefined", async () => { await outside(); note("helper returns"); }],
    ["behind a wait, a thenable", async () => { await outside(); note("helper returns"); return thenable; }],
    ["behind a wait, a promise", async i => { await outside(); note("helper returns"); return Promise.resolve(i); }],
    ["behind a wait, it throws", async i => { await outside(); note("helper throws"); throw new Error("thrown " + i); }],
    ["behind two waits", async i => { await outside(); await outside(); note("helper returns"); return i; }],
    ["queues a job and returns", async i => { await outside(); Promise.resolve().then(() => note("the helper's job")); note("helper returns"); return i; }],
];
async function* awaits(helper: Helper, n: number): AsyncGenerator<string> {
    for (let i = 0; i < n; i++) {
        note("awaits " + i);
        try {
            yield JSON.stringify(await helper(i));
        } catch (error) {
            yield "caught " + (error as Error).message;
        }
    }
}
async function* awaitsKept(helper: Helper): AsyncGenerator<string> {
    const kept = helper(1);
    await outside(); await outside(); await outside(); await outside();
    note("awaits what was kept");
    try {
        yield JSON.stringify(await kept);
    } catch (error) {
        yield "caught " + (error as Error).message;
    }
}
async function* shares(promise: Promise<unknown>, label: string): AsyncGenerator<string> {
    try {
        yield label + " " + JSON.stringify(await promise);
    } catch (error) {
        yield label + " caught " + (error as Error).message;
    }
}
async function collect(source: AsyncGenerator<string>): Promise<void> {
    for await (const x of source) note("got " + x);
}
async function waitsToo(promise: Promise<unknown>): Promise<void> {
    try {
        note("the function got " + JSON.stringify(await promise));
    } catch (error) {
        note("the function caught " + (error as Error).message);
    }
}
async function resumed(run: () => Promise<void>): Promise<void> {
    await outside();
    await run();
}
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = [];
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [title, helper] of helpers) {
    await scene(title + ", alone", () => collect(awaits(helper, 2)));
    await scene(title + ", resumed", () => resumed(() => collect(awaits(helper, 2))));
    await scene(title + ", beside jobs", () => Promise.all([ticker("t", 14), collect(awaits(helper, 2))]));
    await scene(title + ", resumed beside jobs", () => Promise.all([resumed(() => collect(awaits(helper, 2))), ticker("t", 16)]));
    await scene(title + ", kept", () => collect(awaitsKept(helper)));
    await scene(title + ", a generator and a function wait", () => { const promise = helper(5); return Promise.all([collect(shares(promise, "first")), waitsToo(promise)]); });
    await scene(title + ", a function and a generator wait", () => { const promise = helper(6); return Promise.all([waitsToo(promise), collect(shares(promise, "second"))]); });
    await scene(title + ", two generators wait", () => { const promise = helper(7); return Promise.all([collect(shares(promise, "first")), collect(shares(promise, "second"))]); });
    await scene(title + ", two streams at once", () => Promise.all([collect(awaits(helper, 2)), collect(awaits(helper, 2))]));
}
console.log(lines.join("\n"));
