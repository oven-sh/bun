// `await` in the body of an async generator, ahead of a yield: of null, a number, a string, a settled promise, a fresh one, a rejected one, one that is pending, a thenable, a record, a
// promise of a subclass, a promise with a `then` or a `constructor` of its own, a call of an async function that ends at once and of one that waits. While `for await` or `yield*` of the
// program steps the generator and no other job is queued, an await of what is settled goes on in place. It must not where somebody could tell: beside other jobs, and under a next() that
// the program calls itself, where the caller runs on before the body does. Beside every run a chain of `then` callbacks notes the turns of the job queue.
// At the end the program counts how often a step had to be finished by the run time while a stream that only awaits what is settled was alone.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
type Stream = AsyncGenerator<unknown, void, unknown>;
let log: string[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return typeof value + " " + String(value);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
class Thenable {
    constructor(private value: number) {}
    then(resolve: (value: number) => void): void {
        note("then is called");
        resolve(this.value);
    }
}
class Derived<T> extends Promise<T> {}
const settled = Promise.resolve("settled");
async function doubles(n: number): Promise<number> { return n * 2; }
async function doublesLater(n: number): Promise<number> { await outside(); return n * 2; }
function withOwnThen(n: number): Promise<number> {
    const promise = Promise.resolve(n);
    (promise as any).then = (resolve: (value: string) => void): void => { note("the promise's own then is called"); resolve("from its own then " + n); };
    return promise;
}
function withOwnConstructor(n: number): Promise<number> {
    const promise = Promise.resolve(n);
    (promise as any).constructor = function Other(): void {};
    return promise;
}
function oneOfEachKind(i: number): unknown {
    switch (i) {
    case 0: return null;
    case 1: return settled;
    case 2: return outside();
    case 3: return new Thenable(i);
    case 4: return i;
    case 5: return { n: i };
    case 6: return Promise.resolve(i);
    default: return undefined;
    }
}

async function* awaitsNull(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); await null; note("behind the await " + i); yield i; }
}
async function* awaitsANumber(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await i; note("behind the await " + i); yield v + 1; }
}
async function* awaitsAString(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await ("s" + i); note("behind the await " + i); yield v; }
}
async function* awaitsASettledPromise(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await settled; note("behind the await " + i); yield v + i; }
}
async function* awaitsAFreshPromise(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await Promise.resolve(i); note("behind the await " + i); yield v; }
}
async function* awaitsARejectedPromise(n: number): Stream {
    for (let i = 0; i < n; i++) {
        note("awaits " + i);
        try { await Promise.reject(new RangeError("rejected " + i)); } catch (error) { note("caught " + show(error)); }
        yield i;
    }
}
async function* awaitsAPendingPromise(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); await outside(); note("behind the await " + i); yield i; }
}
async function* awaitsAThenable(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await new Thenable(i); note("behind the await " + i); yield v; }
}
async function* awaitsARecord(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await { n: i }; note("behind the await " + i); yield v.n; }
}
async function* awaitsACall(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await doubles(i); note("behind the await " + i); yield v; }
}
async function* awaitsACallThatWaits(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await doublesLater(i); note("behind the await " + i); yield v; }
}
async function* awaitsEach(make: (i: number) => unknown, n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await make(i); note("behind the await " + i); yield v; }
}
async function* awaitsThreeTimes(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); await null; note("once"); await settled; note("twice"); await i; note("three times"); yield i; }
}
async function* awaitsSettledThenPending(n: number): Stream {
    for (let i = 0; i < n; i++) { note("awaits " + i); await null; note("once"); await outside(); note("twice"); await null; note("three times"); yield i; }
}
async function* awaitsBehindTheLastYield(n: number): Stream {
    for (let i = 0; i < n; i++) yield i;
    note("awaits at the end");
    await null;
    note("behind the await at the end");
}
async function* awaitsInAFinally(): Stream {
    try {
        for (let i = 0; ; i++) yield i;
    } finally {
        note("the finally awaits");
        await null;
        note("the finally goes on");
        await settled;
        note("the finally ends");
    }
}
async function* awaitsOnly(): Stream {
    note("awaits");
    await null;
    note("behind the await");
}
async function* relays(source: Stream): Stream {
    for await (const x of source) { note("the relay awaits"); await null; note("relays " + show(x)); yield x; }
}
async function* forwards(source: Stream): Stream {
    await null;
    note("forwards");
    yield* source;
}

const producers: [string, () => Stream][] = [
    ["null", () => awaitsNull(3)],
    ["a number", () => awaitsANumber(3)],
    ["a string", () => awaitsAString(3)],
    ["a settled promise", () => awaitsASettledPromise(3)],
    ["a fresh promise", () => awaitsAFreshPromise(3)],
    ["a rejected promise", () => awaitsARejectedPromise(3)],
    ["a pending promise", () => awaitsAPendingPromise(3)],
    ["a thenable", () => awaitsAThenable(3)],
    ["a record", () => awaitsARecord(3)],
    ["a call", () => awaitsACall(3)],
    ["a call that waits", () => awaitsACallThatWaits(3)],
    ["a promise of a subclass", () => awaitsEach(i => Derived.resolve(i), 3)],
    ["a promise with its own then", () => awaitsEach(withOwnThen, 3)],
    ["a promise with its own constructor", () => awaitsEach(withOwnConstructor, 3)],
    ["now one kind, now another", () => awaitsEach(oneOfEachKind, 8)],
    ["three times", () => awaitsThreeTimes(3)],
    ["what is settled, then what is pending", () => awaitsSettledThenPending(2)],
    ["behind the last yield", () => awaitsBehindTheLastYield(2)],
    ["and never yields", () => awaitsOnly()],
    ["null, under for await", () => relays(awaitsNull(2))],
    ["null, under yield*", () => forwards(awaitsNull(2))],
    ["a pending promise, under a chain of three", () => relays(forwards(awaitsAPendingPromise(2)))],
    ["a settled promise, under a chain of three", () => forwards(relays(awaitsASettledPromise(2)))],
];

async function loops(source: Stream, isResumedFirst: boolean): Promise<void> {
    if (isResumedFirst) await null;
    for await (const x of source) note("got " + show(x));
    note("the loop is through");
}
async function asksOneByOne(source: Stream): Promise<void> {
    await null;
    for (;;) {
        const asked = source.next();
        note("has asked");
        const step = await asked;
        if (step.done) break;
        note("got " + show(step.value));
    }
    note("is through");
}
function asksThreeTimes(source: Stream): Promise<void> {
    const asked = [source.next(), source.next(), source.next()];
    note("has asked three times");
    return Promise.all(asked).then(steps => note("got " + steps.map(show).join(" ")));
}
const drivers: [string, (source: Stream) => Promise<void>][] = [
    ["a loop", source => loops(source, true)],
    ["a loop in its first run", source => loops(source, false)],
    ["next() one by one", asksOneByOne],
    ["next() three times at once", asksThreeTimes],
    ["next() in a job", source => Promise.resolve().then(() => asksThreeTimes(source))],
];
for (const [what, make] of producers) {
    for (const [how, drive] of drivers) {
        for (const company of ["alone", "behind jobs", "ahead of jobs"]) {
            const all: Promise<void>[] = [];
            if (company === "behind jobs") all.push(ticker("t", 12));
            all.push(drive(make()));
            note("back in the module");
            if (company === "ahead of jobs") all.push(ticker("t", 12));
            await Promise.all(all);
            out.push("awaits " + what + ", driven by " + how + ", " + company + ": " + log.join(" | "));
            log = [];
        }
    }
}

// return() and a break run the finally, whose awaits go by the same rules.
async function leavesAt(source: Stream, last: number): Promise<void> {
    await null;
    for await (const x of source) { note("got " + show(x)); if (x === last) break; }
    note("the loop has left");
}
for (const company of ["alone", "behind jobs"]) {
    const beside = company === "behind jobs" ? ticker("t", 12) : undefined;
    await leavesAt(awaitsInAFinally(), 1);
    await beside;
    out.push("awaits in a finally, at a break, " + company + ": " + log.join(" | "));
    log = [];
    const besideTheChain = company === "behind jobs" ? ticker("t", 16) : undefined;
    await leavesAt(relays(awaitsInAFinally()), 1);
    await besideTheChain;
    out.push("awaits in a finally, at a break of a chain, " + company + ": " + log.join(" | "));
    log = [];
    const byHand = awaitsInAFinally();
    note("got " + show(await byHand.next()));
    const besideTheReturn = company === "behind jobs" ? ticker("t", 8) : undefined;
    const returned = byHand.return(undefined);
    note("has asked to return");
    note("got " + show(await returned));
    await besideTheReturn;
    out.push("awaits in a finally, at return() by hand, " + company + ": " + log.join(" | "));
    log = [];
}

function finished(): number {
    return counted ? counted("operationAOTFinishAsyncIteratorStep") : 0;
}
async function measure(title: string, steps: number, source: Stream): Promise<void> {
    await null;
    const before = finished();
    let seen = 0;
    for await (const _ of source) seen++;
    const entered = finished() - before;
    out.push(title + ": " + seen + " values, " + (entered * 20 < steps ? "few steps finished by the run time" : entered + " OF " + steps + " STEPS FINISHED BY THE RUN TIME"));
    log = [];
}
const N = 2000;
for (let round = 0; round < 2; round++) {
    await measure("awaits null", N, awaitsNull(N));
    await measure("awaits a number", N, awaitsANumber(N));
    await measure("awaits a string", N, awaitsAString(N));
    await measure("awaits a settled promise", N, awaitsASettledPromise(N));
    await measure("awaits a fresh promise", N, awaitsAFreshPromise(N));
    await measure("awaits three times", N, awaitsThreeTimes(N));
    await measure("awaits null, under for await", 2 * N, relays(awaitsNull(N)));
    await measure("awaits a settled promise, under yield*", 2 * N, forwards(awaitsASettledPromise(N)));
}
console.log(out.join("\n"));
export {};
