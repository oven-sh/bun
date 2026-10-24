// What an async generator yields is awaited before the consumer gets it, so a step whose value is a promise or may have a `then` cannot hand its value over in place, however alone the
// stream is. Streams that yield promises (fulfilled, pending, rejected, of a subclass, with a `then` or a `constructor` of their own, of async functions) and thenables (that answer at once,
// later, twice, with another thenable, that reject, that throw), by turns with plain numbers; the same values returned. `yield*` hands on what its source gives and awaits nothing: a promise
// or a thenable from a hand-written iterator reaches the consumer as it is, while a sync iterable's values are awaited by its wrapper.
// Objects that went through many times without a `then` get one in the middle of a stream, on their class, on themselves, in a declared field, and lose it again.
// Beside every run a chain of `then` callbacks notes the turns of the job queue.
type Stream = AsyncGenerator<unknown, unknown, unknown>;
type Resolve = (value: unknown) => void;
type Make = (i: number) => unknown;
let log: string[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (value instanceof Promise) return "a promise";
    if (typeof value === "object" && value !== null) return value.constructor.name + JSON.stringify(value);
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
    constructor(public n: number) {}
    then(resolve: Resolve): void {
        note("Thenable.then " + this.n);
        resolve("from the thenable " + this.n);
    }
}
class Derived<T> extends Promise<T> {}
const settled = Promise.resolve("settled long ago");
async function doubles(n: number): Promise<number> { return n * 2; }
async function doublesLater(n: number): Promise<number> { await outside(); return n * 2; }
async function fails(n: number): Promise<number> { throw new RangeError("the async function failed " + n); }
function withOwnThen(n: number): Promise<number> {
    const promise = Promise.resolve(n);
    (promise as any).then = (resolve: Resolve): void => { note("the promise's own then is called"); resolve("from its own then " + n); };
    return promise;
}
function withOwnConstructor(n: number): Promise<number> {
    const promise = Promise.resolve(n);
    (promise as any).constructor = function Other(): void {};
    return promise;
}

const makers: [string, Make][] = [
    ["a number", i => i * 10],
    ["a fulfilled promise", i => Promise.resolve("fulfilled " + i)],
    ["one promise again and again", () => settled],
    ["a pending promise", i => outside().then(() => "released " + i)],
    ["a rejected promise", i => Promise.reject(new RangeError("rejected " + i))],
    ["a promise that is rejected later", i => outside().then(() => { throw new RangeError("rejected later " + i); })],
    ["the promise of an async function", i => doubles(i)],
    ["the promise of an async function that waits", i => doublesLater(i)],
    ["the promise of an async function that fails", i => fails(i)],
    ["a promise of a subclass", i => Derived.resolve("derived " + i)],
    ["a promise with its own then", withOwnThen],
    ["a promise with its own constructor", withOwnConstructor],
    ["a thenable", i => new Thenable(i)],
    ["a thenable that answers later", i => ({ then(resolve: Resolve): void { note("then is called"); outside().then(() => resolve("late " + i)); } })],
    ["a thenable that answers twice", i => ({ then(resolve: Resolve): void { note("then is called"); resolve("first " + i); resolve("second " + i); } })],
    ["a thenable that gives a thenable", i => ({ then(resolve: Resolve): void { note("the outer then is called"); resolve(new Thenable(i)); } })],
    ["a thenable that gives a promise", i => ({ then(resolve: Resolve): void { note("then is called"); resolve(doublesLater(i)); } })],
    ["a thenable that rejects", i => ({ then(_: Resolve, reject: Resolve): void { note("then is called"); reject(new RangeError("refused " + i)); } })],
    ["a thenable that throws", i => ({ then(): void { note("then is called"); throw new RangeError("thrown by then " + i); } })],
    ["a thenable that answers and then throws", i => ({ then(resolve: Resolve): void { resolve("answered " + i); throw new RangeError("too late " + i); } })],
    ["then is a number", i => ({ then: i })],
    ["then is a getter", i => Object.defineProperty({ n: i }, "then", { get() { note("then is read"); return undefined; }, enumerable: false })],
    ["then is a getter that throws", i => Object.defineProperty({ n: i }, "then", { get() { note("then is read"); throw new RangeError("thrown by the getter " + i); }, enumerable: false })],
    ["a record", i => ({ n: i })],
    ["a promise in a record", i => ({ n: i, inside: Promise.resolve(i) })],
    ["a promise in an array", i => [Promise.resolve(i)]],
];

async function* yieldsEach(make: Make, n: number): Stream {
    for (let i = 0; i < n; i++) { note("yields " + i); yield make(i); note("behind the yield " + i); }
    return "the end";
}
async function* yieldsByTurns(make: Make, n: number): Stream {
    for (let i = 0; i < n; i++) {
        try {
            note("yields " + i);
            yield i % 2 ? make(i) : i;
            note("behind the yield " + i);
        } catch (error) {
            note("the producer caught " + show(error));
        }
    }
    return "the end";
}
async function* returnsIt(make: Make): Stream {
    yield 0;
    note("returns");
    return make(1);
}
async function* returnsItFromATry(make: Make): Stream {
    try {
        yield 0;
        note("returns");
        return make(1);
    } catch (error) {
        note("the producer caught " + show(error));
        return "returned from the catch";
    } finally {
        note("the producer's finally");
    }
}
async function* relays(source: AsyncIterable<unknown>): Stream {
    for await (const x of source) { note("relays " + show(x)); yield x; }
    return "the relay's end";
}
async function* forwards(source: AsyncIterable<unknown> | Iterable<unknown>): Stream {
    const returned = yield* source;
    note("yield* was returned " + show(returned));
    return "the forwarder's end";
}
async function* forwardsAndCatches(source: AsyncIterable<unknown> | Iterable<unknown>): Stream {
    try {
        yield* source;
    } catch (error) {
        note("the forwarder caught " + show(error));
        yield "goes on behind the catch";
    }
    return "the forwarder's end";
}
function handWritten(label: string, n: number, make: Make): AsyncIterable<unknown> {
    let i = 0;
    return {
        [Symbol.asyncIterator]() {
            return {
                next(): Promise<IteratorResult<unknown, unknown>> {
                    note(label + ".next is called");
                    const result: IteratorResult<unknown, unknown> = i < n ? { value: make(i++), done: false } : { value: label + "'s end", done: true };
                    return Promise.resolve(result);
                },
                return(value?: unknown): Promise<IteratorResult<unknown, unknown>> {
                    note(label + ".return is called");
                    const result: IteratorResult<unknown, unknown> = { value, done: true };
                    return Promise.resolve(result);
                },
            };
        },
    };
}

async function consumes(source: AsyncIterable<unknown>, isResumedFirst: boolean): Promise<void> {
    if (isResumedFirst) await null;
    try {
        for await (const x of source) {
            note("got " + show(x));
            if (!(x instanceof Promise)) continue;
            try { note("in it is " + show(await x)); } catch (error) { note("it is rejected with " + show(error)); }
        }
        note("the loop is through");
    } catch (error) {
        note("the loop caught " + show(error));
    }
}
async function scene(title: string, make: () => AsyncIterable<unknown>): Promise<void> {
    for (const [company, isResumedFirst, jobs] of [["alone", true, 0], ["in its first run", false, 0], ["behind jobs", true, 14]] as [string, boolean, number][]) {
        log = [];
        const beside = jobs ? ticker("t", jobs) : undefined;
        await consumes(make(), isResumedFirst);
        await beside;
        out.push(title + ", " + company + ": " + log.join(" | "));
    }
}

for (const [what, make] of makers) {
    await scene("yields " + what, () => yieldsEach(make, 3));
    await scene("yields a number and " + what + " by turns", () => yieldsByTurns(make, 5));
    await scene("yields " + what + ", under for await", () => relays(yieldsByTurns(make, 4)));
    await scene("yields " + what + ", under yield*", () => forwards(yieldsByTurns(make, 4)));
    await scene("yields " + what + ", under yield* that catches", () => forwardsAndCatches(yieldsEach(make, 2)));
    await scene("returns " + what, () => forwards(returnsIt(make)));
    await scene("returns " + what + " from a try", () => forwards(returnsItFromATry(make)));
    await scene("a hand-written iterator gives " + what + ", under yield*", () => forwards(handWritten("h", 2, make)));
    await scene("a hand-written iterator gives " + what + ", under yield* twice", () => forwards(forwards(handWritten("h", 2, make))));
    await scene("a hand-written iterator gives " + what + ", under for await", () => relays(handWritten("h", 2, make)));
    await scene("an array holds " + what + ", under yield*", () => forwardsAndCatches([0, make(1), 2]));
}

// The thenable test of a step goes by what the object is now, not by what objects of its kind were.
class Parcel { constructor(public n: number) {} }
interface Reply { text: string; then?: (resolve: Resolve) => void; }
type Hook = (step: number) => void;
async function* yieldsParcels(n: number, hook: Hook): Stream {
    for (let i = 0; i < n; i++) { hook(i); yield new Parcel(i); }
    return "the end";
}
async function* yieldsTheSame(value: unknown, n: number, hook: Hook): Stream {
    for (let i = 0; i < n; i++) { hook(i); yield value; }
    return "the end";
}
// What the loop got, as runs of one kind: `Parcel{"n":#} x100, string opened # x3, ..`.
async function summarizes(source: Stream, hook: Hook): Promise<string> {
    await null;
    const runs: string[] = [];
    let kindOfRun = "", lengthOfRun = 0, seen = 0;
    for await (const x of source) {
        const kind = show(x).replace(/[0-9]+/, "#");
        if (kind !== kindOfRun) {
            if (lengthOfRun) runs.push(kindOfRun + " x" + lengthOfRun);
            kindOfRun = kind;
            lengthOfRun = 0;
        }
        lengthOfRun++;
        hook(++seen);
    }
    runs.push(kindOfRun + " x" + lengthOfRun);
    return runs.join(", ");
}
const doesNothing: Hook = () => {};
function between(from: number, to: number, give: () => void, take: () => void): Hook {
    return step => {
        if (step === from) give();
        if (step === to) take();
    };
}
const giveTheClass = (): void => { (Parcel.prototype as any).then = function (this: Parcel, resolve: Resolve): void { resolve("opened " + this.n); }; };
const takeFromTheClass = (): void => { delete (Parcel.prototype as any).then; };
async function report(title: string, jobs: number, run: () => Promise<string>): Promise<void> {
    const beside = jobs ? ticker("t", jobs) : undefined;
    const runs = await run();
    await beside;
    out.push(title + (jobs ? ", beside jobs: " : ", alone: ") + runs);
    log = [];
}
// Alone the objects go through a hundred times first. Beside jobs the stream is short, so that the jobs last longer than it does.
for (const [jobs, n, from] of [[0, 300, 100], [400, 30, 10]]) {
    const forThreeSteps = (give: () => void, take: () => void): Hook => between(from, from + 3, give, take);
    await report("the class gets a then from the loop", jobs, () => summarizes(yieldsParcels(n, doesNothing), forThreeSteps(giveTheClass, takeFromTheClass)));
    await report("the class gets a then from the producer", jobs, () => summarizes(yieldsParcels(n, forThreeSteps(giveTheClass, takeFromTheClass)), doesNothing));
    await report("the class gets a then from the loop, under a chain of three", jobs, () => summarizes(relays(forwards(yieldsParcels(n, doesNothing))), forThreeSteps(giveTheClass, takeFromTheClass)));
    await report("the class gets a then from the producer, under a chain of three", jobs, () => summarizes(forwards(relays(yieldsParcels(n, forThreeSteps(giveTheClass, takeFromTheClass)))), doesNothing));

    const parcel = new Parcel(7);
    const giveTheParcel = (): void => { (parcel as any).then = (resolve: Resolve): void => resolve("opened by its own then"); };
    const takeFromTheParcel = (): void => { delete (parcel as any).then; };
    await report("one instance gets a then from the loop", jobs, () => summarizes(yieldsTheSame(parcel, n, doesNothing), forThreeSteps(giveTheParcel, takeFromTheParcel)));
    await report("one instance gets a then from the producer", jobs, () => summarizes(yieldsTheSame(parcel, n, forThreeSteps(giveTheParcel, takeFromTheParcel)), doesNothing));

    const reply: Reply = { text: "bare" };
    const giveTheReply = (): void => { reply.then = resolve => resolve("the reply's field"); };
    const takeFromTheReply = (): void => { reply.then = undefined; };
    await report("a declared field gets a then from the loop", jobs, () => summarizes(yieldsTheSame(reply, n, doesNothing), forThreeSteps(giveTheReply, takeFromTheReply)));
    await report("a declared field gets a then from the producer", jobs, () => summarizes(yieldsTheSame(reply, n, forThreeSteps(giveTheReply, takeFromTheReply)), doesNothing));

    const parent: { then?: (resolve: Resolve) => void } = {};
    const child: unknown = Object.create(parent);
    const giveTheParent = (): void => { parent.then = resolve => resolve("the parent's then"); };
    const takeFromTheParent = (): void => { delete parent.then; };
    await report("the prototype of a plain object gets a then from the loop", jobs, () => summarizes(yieldsTheSame(child, n, doesNothing), forThreeSteps(giveTheParent, takeFromTheParent)));
    await report("the prototype of a plain object gets a then from the producer", jobs, () => summarizes(yieldsTheSame(child, n, forThreeSteps(giveTheParent, takeFromTheParent)), doesNothing));
}
console.log(out.join("\n"));
export {};
