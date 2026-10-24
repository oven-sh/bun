// `for await` and next() over async generators of the program: in which order the producer, the consumer and everything else run:
// a consumer in its first run and one that has been resumed, alone, ahead of other jobs and behind them; every kind of yielded value;
// awaits between yields; chains; several requests at once; return() and throw() while suspended; await in finally.
let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
    if (typeof value === "object" && value !== null) return value.constructor?.name + JSON.stringify(value);
    return typeof value + " " + String(value);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
// Settled by a job two turns on: whoever awaits it waits in earnest, and nobody has to stand by to release it.
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
class Thenable {
    constructor(private label: string, private value: number) {}
    then(onFulfilled: (value: number) => void): void {
        note(this.label + " then is called");
        onFulfilled(this.value);
    }
}
const settled = Promise.resolve(10);

async function* numbers(n: number): AsyncGenerator<number> {
    note("numbers starts");
    for (let i = 0; i < n; i++) { note("yields " + i); yield i; note("behind yield " + i); }
    note("numbers ends");
}
async function* ofManyKinds(label: string): AsyncGenerator<unknown> {
    yield 1.5;
    yield "text";
    yield undefined;
    yield null;
    yield { value: 1, done: true };
    yield [1, 2];
    yield Promise.resolve("fulfilled");
    yield new Thenable(label, 7);
    yield settled;
    yield outside().then(() => "released");
    yield { then: 5 };
    yield Object.defineProperty({}, "then", { get() { note(label + " then is read"); return undefined; } });
}
async function* awaitsBetween(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) { note("awaits " + i); const v = await settled; note("awaited " + i); yield i + v; }
}
async function* awaitsOutside(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) { note("waits " + i); await outside(); note("waited " + i); yield i; yield i + 100; }
}
async function* queuesJobs(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) { Promise.resolve().then(() => note("job of the producer " + i)); yield i; }
}
async function* doubled(source: AsyncIterable<number>): AsyncGenerator<number> {
    note("doubled starts");
    for await (const x of source) { note("doubles " + x); yield x * 2; }
    note("doubled ends");
}
async function* delegates(n: number): AsyncGenerator<number> {
    yield -1;
    const returned = yield* returnsSomething(n);
    note("delegate returned " + returned);
    yield -2;
}
async function* returnsSomething(n: number): AsyncGenerator<number, string> {
    for (let i = 0; i < n; i++) yield i;
    return "the end";
}
async function* throwsAt(n: number): AsyncGenerator<number> {
    for (let i = 0; ; i++) { if (i === n) throw new RangeError("at " + n); yield i; }
}
async function* yieldsRejected(): AsyncGenerator<number> {
    yield 1;
    try { yield Promise.reject(new Error("rejected operand")) as Promise<number>; } catch (error) { note("producer caught " + show(error)); }
    yield 2;
}
async function* cleansUp(label: string): AsyncGenerator<number> {
    try {
        for (let i = 0; ; i++) yield i;
    } finally {
        note(label + " finally starts");
        await null;
        note(label + " finally goes on");
        await settled;
        note(label + " finally ends");
    }
}
async function* takesWhatIsSent(): AsyncGenerator<number, void, string | undefined> {
    let sent = yield 0;
    for (let i = 1; i < 4; i++) { note("was sent " + sent); sent = yield i; }
}
function fail(text: string): number { throw new RangeError(text); }
async function* bindsParameters(n: number = fail("while the parameters are bound"), { step }: { step: number } = { step: 1 }): AsyncGenerator<number> {
    note("binds parameters starts");
    for (let i = 0; i < n; i += step) yield i;
}
async function* throwsBehindAwaits(n: number): AsyncGenerator<number> {
    for (let i = 0; ; i++) { await settled; if (i === n) fail("behind awaits"); yield i; await null; }
}
async function* catchesWhatItsSourceThrows(source: AsyncIterable<number>): AsyncGenerator<number> {
    try { for await (const x of source) yield x; } catch (error) { note("the middle caught " + show(error)); yield -1; }
}
class Stream {
    constructor(private n: number) {}
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for await (const x of this.#inner()) yield "event " + x;
    }
    async *#inner(): AsyncGenerator<number> {
        for (let i = 0; i < this.n; i++) yield i;
    }
}

const kinds = 25;
async function run(kind: number, label: string, isResumedFirst: boolean): Promise<void> {
    if (isResumedFirst) await null;
    note(label + " begins");
    try {
        switch (kind) {
        case 0: for await (const x of numbers(3)) note(label + " got " + x); break;
        case 1: for await (const x of ofManyKinds(label)) note(label + " got " + show(x)); break;
        case 2: for await (const x of awaitsBetween(3)) note(label + " got " + x); break;
        case 3: for await (const x of awaitsOutside(2)) note(label + " got " + x); break;
        case 4: for await (const x of queuesJobs(3)) note(label + " got " + x); break;
        case 5: for await (const x of doubled(numbers(3))) note(label + " got " + x); break;
        case 6: for await (const x of doubled(doubled(awaitsBetween(2)))) note(label + " got " + x); break;
        case 7: for await (const x of delegates(2)) note(label + " got " + x); break;
        case 8: for await (const x of throwsAt(2)) note(label + " got " + x); break;
        case 9: for await (const x of yieldsRejected()) note(label + " got " + x); break;
        case 10: for await (const x of cleansUp(label)) { note(label + " got " + x); if (x === 2) break; } break;
        case 11: for await (const x of cleansUp(label)) { note(label + " got " + x); if (x === 1) throw new Error("thrown by the consumer"); } break;
        case 12: for await (const x of doubled(cleansUp(label))) { note(label + " got " + x); if (x === 2) break; } break;
        case 13: for await (const x of new Stream(3)) note(label + " got " + x); break;
        case 14: {
            const g = numbers(3);
            for (let step = await g.next(); !step.done; step = await g.next()) note(label + " got " + step.value);
            note(label + " behind the end " + show(await g.next()));
            break;
        }
        case 15: {
            const g = numbers(4);
            const all = [g.next(), g.next(), g.next()];
            note(label + " asked three times");
            for (const step of all) note(label + " got " + show(await step));
            for await (const x of g) note(label + " then got " + x);
            break;
        }
        case 16: {
            const g = cleansUp(label);
            note(label + " got " + show(await g.next()));
            const first = g.next(), returned = g.return(42), behind = g.next();
            note(label + " got " + show(await first) + " " + show(await returned) + " " + show(await behind));
            break;
        }
        case 17: {
            const g = cleansUp(label);
            note(label + " got " + show(await g.next()));
            try { await g.throw(new Error("thrown in")); } catch (error) { note(label + " got back " + show(error)); }
            note(label + " got " + show(await g.next()));
            const fresh = numbers(2);
            note(label + " returned ahead of the start " + show(await fresh.return(5)) + " " + show(await fresh.next()));
            break;
        }
        case 18: {
            const g = takesWhatIsSent();
            note(label + " got " + show(await g.next("lost")));
            for (const text of ["a", "b", "c", "d"]) note(label + " got " + show(await g.next(text)));
            break;
        }
        case 19: {
            const g = numbers(6);
            for await (const x of g) { note(label + " got " + x); if (x === 1) break; }
            note(label + " behind the break " + show(await g.next()));
            let sum = 0;
            for await (const x of numbersQuietly(200)) sum += x;
            note(label + " sum " + sum);
            break;
        }
        case 20: for await (const x of bindsParameters(3, { step: 2 })) note(label + " got " + x); break;
        case 21: {
            let made: AsyncGenerator<number> | undefined;
            try { made = bindsParameters(); } catch (error) { note(label + " the call threw " + show(error)); }
            note(label + " made " + typeof made);
            for await (const x of bindsParameters(2)) note(label + " got " + x);
            break;
        }
        case 22: for await (const x of throwsBehindAwaits(2)) note(label + " got " + x); break;
        case 23: for await (const x of doubled(throwsBehindAwaits(1))) note(label + " got " + x); break;
        case 24: for await (const x of doubled(catchesWhatItsSourceThrows(throwsAt(1)))) note(label + " got " + x); break;
        }
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    }
}
async function* numbersQuietly(n: number): AsyncGenerator<number> { for (let i = 0; i < n; i++) yield i; }

// Two consumers of two producers at once, and two of one.
async function consumer(label: string, source: AsyncGenerator<number>): Promise<void> {
    for await (const x of source) note(label + " got " + x);
    note(label + " is through");
}

const out: string[] = [];
function flush(title: string): void {
    out.push(title + ": " + log.join(" | "));
    log = [];
}
for (let kind = 0; kind < kinds; kind++) {
    for (const isResumedFirst of [false, true]) {
        for (const company of ["alone", "ahead of jobs", "behind jobs"]) {
            const ahead = company === "behind jobs" ? ticker("t", 9) : undefined;
            const running = run(kind, "c" + kind, isResumedFirst);
            note("back in the module");
            const behind = company === "ahead of jobs" ? ticker("t", 9) : undefined;
            await running;
            await ahead;
            await behind;
            flush(kind + (isResumedFirst ? " resumed " : " first run ") + company);
        }
    }
}
await Promise.all([consumer("a", numbersQuietly(3)), consumer("b", numbersQuietly(3)), ticker("t", 8)]);
flush("two of two");
const shared = numbersQuietly(6);
await Promise.all([consumer("a", shared), consumer("b", shared), ticker("t", 8)]);
flush("two of one");
console.log(out.join("\n"));
