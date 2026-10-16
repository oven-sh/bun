// `yield*` in an async generator over what is only sync iterable: arrays, sets, maps, sync generators of the program, iterators written by hand:
// empty, of one, of several; what they return; what next(v), throw(e) and return(v) of the outer generator hand to the inner one; elements that are promises
// (fulfilled, pending, rejected), thenables, records; inner iterators that throw; alone, resumed behind a wait, and beside other jobs with a ticker that shows every turn.
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
function rejected(text: string): Promise<never> {
    const promise = Promise.reject(new Error(text));
    promise.catch(() => undefined);
    return promise;
}
const thenable = { then(resolve: (value: string) => void): void { note("then is called"); resolve("from then"); } };
function* nothing(): Generator<never, string> { note("nothing runs"); return "nothing returned"; }
function* one(): Generator<string, string> { yield "only"; return "one returned"; }
function* three(): Generator<number, number> { let t = 0; for (let i = 1; i <= 3; i++) { yield i; t += i; } return t; }
function* listens(): Generator<string, string, unknown> {
    const first = yield "say something";
    const second = yield "heard " + JSON.stringify(first);
    return "last heard " + JSON.stringify(second);
}
function* cleansUp(): Generator<number, string> {
    try { yield 1; yield 2; return "ran through"; } catch (error) { note("inner caught " + (error as Error).message); yield 99; return "behind the catch"; } finally { note("inner finally"); }
}
function* throwsAtOnce(): Generator<number> { throw new Error("thrown at once"); }
function* throwsLater(): Generator<number> { yield 1; throw new Error("thrown later"); }
function* queuesAJob(): Generator<number> { Promise.resolve().then(() => note("the inner one's job")); yield 1; yield 2; }
function* yieldsPromises(): Generator<unknown> { yield Promise.resolve("fulfilled"); yield outside().then(() => "was pending"); yield thenable; yield { n: 1 }; }
function* yieldsARejection(): Generator<unknown> { try { yield 1; yield rejected("rejected element"); yield 3; } finally { note("inner finally"); } }
function byHand(steps: unknown[]): Iterable<unknown> {
    let i = 0;
    return { [Symbol.iterator]() { return { next(...sent: unknown[]) { note("next with " + sent.length + " arguments"); return i < steps.length ? { value: steps[i++], done: false } : { value: "by hand is over", done: true }; } }; } };
}
const kinds: [string, () => Iterable<unknown>][] = [
    ["an empty array", () => []],
    ["an array of one", () => [{ n: 1 }]],
    ["an array of three", () => [1, "two", { n: 3 }]],
    ["an array with a hole and undefined", () => [1, , undefined, null] as unknown[]],
    ["an array of promises", () => [Promise.resolve("a"), outside().then(() => "b"), thenable, "c"]],
    ["an array with a rejection", () => [1, rejected("rejected in an array"), 3]],
    ["a set", () => new Set([1, 2])],
    ["a map", () => new Map([["k", 1]])],
    ["a text", () => "ab"],
    ["a generator of nothing", nothing],
    ["a generator of one", one],
    ["a generator of three", three],
    ["a generator that listens", listens],
    ["a generator that cleans up", cleansUp],
    ["a generator that throws at once", throwsAtOnce],
    ["a generator that throws later", throwsLater],
    ["a generator that queues a job", queuesAJob],
    ["a generator of promises", yieldsPromises],
    ["a generator with a rejection", yieldsARejection],
    ["by hand", () => byHand([1, 2])],
    ["by hand, empty", () => byHand([])],
];
async function* delegates(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    note("outer begins");
    const returned = yield* make();
    note("inner returned " + JSON.stringify(returned));
    return "outer is over";
}
async function* delegatesTwice(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    const first = yield* make();
    const second = yield* make();
    return JSON.stringify(first) + " and " + JSON.stringify(second);
}
async function* delegatesBehindAWait(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    await outside();
    const returned = yield* make();
    await outside();
    return "behind the waits " + JSON.stringify(returned);
}
async function byLoop(source: AsyncGenerator<unknown, string, unknown>): Promise<void> {
    try {
        for await (const x of source) note("got " + JSON.stringify(x));
        note("the loop is over");
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function byNext(source: AsyncGenerator<unknown, string, unknown>): Promise<void> {
    try {
        for (let i = 0; ; i++) {
            const step = await source.next("sent " + i);
            note((step.done ? "done " : "step ") + JSON.stringify(step.value));
            if (step.done) return;
        }
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function thrownInto(source: AsyncGenerator<unknown, string, unknown>): Promise<void> {
    try {
        note("first " + JSON.stringify(await source.next()));
        note("thrown into " + JSON.stringify(await source.throw(new Error("from outside"))));
        note("then " + JSON.stringify(await source.next()));
        note("then " + JSON.stringify(await source.next()));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function returnedInto(source: AsyncGenerator<unknown, string, unknown>): Promise<void> {
    try {
        note("first " + JSON.stringify(await source.next()));
        note("returned into " + JSON.stringify(await source.return("given up")));
        note("then " + JSON.stringify(await source.next()));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function* through(source: AsyncGenerator<unknown, string, unknown>): AsyncGenerator<unknown, string, unknown> {
    return yield* source;
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
for (const [kind, make] of kinds) {
    await scene(kind + ", a loop", () => byLoop(delegates(make)));
    await scene(kind + ", a loop, resumed", () => resumed(() => byLoop(delegates(make))));
    await scene(kind + ", a loop beside jobs", () => Promise.all([ticker("t", 14), byLoop(delegates(make))]));
    await scene(kind + ", a loop, resumed beside jobs", () => Promise.all([resumed(() => byLoop(delegates(make))), ticker("t", 16)]));
    await scene(kind + ", next with values", () => byNext(delegates(make)));
    await scene(kind + ", next with values, resumed", () => resumed(() => byNext(delegates(make))));
    await scene(kind + ", twice", () => resumed(() => byNext(delegatesTwice(make))));
    await scene(kind + ", behind a wait", () => byLoop(delegatesBehindAWait(make)));
    await scene(kind + ", through another generator", () => resumed(() => byLoop(through(delegates(make)))));
    await scene(kind + ", thrown into", () => resumed(() => thrownInto(delegates(make))));
    await scene(kind + ", returned into", () => resumed(() => returnedInto(delegates(make))));
    await scene(kind + ", two at once", () => Promise.all([byLoop(delegates(make)), byLoop(delegates(make))]));
}
console.log(lines.join("\n"));
