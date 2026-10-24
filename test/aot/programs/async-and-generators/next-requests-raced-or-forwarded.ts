// The promise that next() of an async generator hands back, given to the engine's own machinery and not awaited where it is made: Promise.race against a promise that never settles or
// settles first, Promise.all, allSettled and any over several streams, an async function or method that returns it (`return inner.next()`), resolve(it) of a new promise, finally();
// over sources that wait, do not wait, and forward by `yield*`; alone, beside other jobs with a ticker that shows every turn, and two at once.
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
type Stream = AsyncGenerator<unknown, unknown, unknown>;
type Step = IteratorResult<unknown, unknown>;
async function* forwards(inner: Stream): Stream { return yield* inner; }
const sources: [string, () => Stream][] = [
    ["waits", async function* () { for (let i = 0; i < 3; i++) { await outside(); yield { n: i }; } return "waits is over"; }],
    ["does not wait", async function* () { yield 1; yield { n: 2 }; return "does not wait is over"; }],
    ["forwarded, waits", () => forwards((async function* () { for (let i = 0; i < 2; i++) { await outside(); yield { n: i }; } return "inner is over"; })())],
    ["forwarded twice", () => forwards(forwards((async function* () { yield "a"; await outside(); yield "b"; return "inner is over"; })()))],
    ["throws", async function* () { await outside(); yield 1; await outside(); throw new Error("thrown by the source"); }],
];
function show(step: Step): string {
    return (step.done ? "done " : "step ") + JSON.stringify(step.value);
}
const never = new Promise<never>(() => undefined);
function tooLate(): Promise<never> {
    return outside().then(outside).then(outside).then(outside).then(() => { throw new Error("too late"); });
}
async function drive(pull: () => Promise<Step | string>): Promise<void> {
    try {
        for (let i = 0; i < 8; i++) {
            const step = await pull();
            if (typeof step === "string") { note(step); continue; }
            note(show(step));
            if (step.done) return;
        }
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
class Wrapper implements AsyncIterableIterator<unknown> {
    constructor(private inner: Stream) {}
    async next(): Promise<Step> { return this.inner.next(); }
    [Symbol.asyncIterator](): this { return this; }
}
class PlainWrapper implements AsyncIterableIterator<unknown> {
    constructor(private inner: Stream) {}
    next(): Promise<Step> { return this.inner.next(); }
    [Symbol.asyncIterator](): this { return this; }
}
async function loopOver(iterable: AsyncIterable<unknown>): Promise<void> {
    try {
        for await (const x of iterable) note("got " + JSON.stringify(x));
        note("the loop is over");
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
const ways: [string, (make: () => Stream) => Promise<void>][] = [
    ["raced against never", make => { const s = make(); return drive(() => Promise.race([s.next(), never])); }],
    ["raced, never first", make => { const s = make(); return drive(() => Promise.race([never, s.next()])); }],
    ["raced against a job", make => { const s = make(); let pending: Promise<Step> | null = null; return drive(async () => { pending ??= s.next(); const won = await Promise.race([pending, Promise.resolve("the job won")]); if (typeof won !== "string") pending = null; return won; }); }],
    ["raced against a wait", make => { const s = make(); let pending: Promise<Step> | null = null; return drive(async () => { pending ??= s.next(); const won = await Promise.race([pending, outside().then(() => "the wait won")]); if (typeof won !== "string") pending = null; return won; }); }],
    ["all of two streams", async make => { const a = make(), b = make(); try { for (let i = 0; i < 5; i++) { const [x, y] = await Promise.all([a.next(), b.next()]); note(show(x) + " & " + show(y)); if (x.done) return; } } catch (error) { note("caught " + (error as Error).message); } }],
    ["allSettled of two streams", async make => { const a = make(), b = make(); for (let i = 0; i < 5; i++) { const both = await Promise.allSettled([a.next(), b.next()]); note(both.map(one => one.status === "fulfilled" ? show(one.value) : "rejected " + one.reason.message).join(" & ")); if (both.some(one => one.status === "rejected" || one.value.done)) return; } }],
    ["any", make => { const s = make(); return drive(() => Promise.any([s.next(), tooLate()])); }],
    ["returned by an async function", make => { const s = make(); return drive(async () => s.next()); }],
    ["returned behind an await", make => { const s = make(); return drive(async () => { await outside(); return s.next(); }); }],
    ["given to resolve", make => { const s = make(); return drive(() => new Promise<Step>(resolve => resolve(s.next()))); }],
    ["Promise.resolve of it", make => { const s = make(); return drive(() => Promise.resolve(s.next())); }],
    ["finally", make => { const s = make(); return drive(() => s.next().finally(() => note("finally"))); }],
    ["a wrapper with an async next", make => loopOver(new Wrapper(make()))],
    ["a wrapper with a plain next", make => loopOver(new PlainWrapper(make()))],
    ["yield* of a wrapper", make => loopOver((async function* () { yield* new PlainWrapper(make()); })())],
];
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = [];
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [way, go] of ways) {
    for (const [kind, make] of sources) {
        await scene(way + ", " + kind, () => go(make));
        await scene(way + ", " + kind + ", beside jobs", () => Promise.all([ticker("t", 18), go(make)]));
        await scene(way + ", " + kind + ", two at once", () => Promise.all([go(make), go(make)]));
    }
}
console.log(lines.join("\n"));
