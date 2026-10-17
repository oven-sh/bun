// `for await` over what is only sync iterable, in async generators and in async functions: arrays, sets, maps, sync generators of the program, iterators written by hand:
// empty, of one, of several; elements that are promises (fulfilled, pending, rejected), thenables, records; inner iterators that throw; loops left by break, by return and by a throw
// (the inner iterator is closed); alone, resumed behind a wait, and beside other jobs with a ticker that shows every turn.
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
async function* loops(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    note("outer begins");
    for await (const x of make()) yield x;
    note("the inner loop is over");
    return "outer is over";
}
async function* loopsTwice(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    for await (const x of make()) yield ["first", x];
    for await (const x of make()) yield ["second", x];
    return "both are over";
}
async function* loopsBehindAWait(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    await outside();
    for await (const x of make()) { yield x; await outside(); }
    return "behind the waits";
}
async function* breaksOff(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    for await (const x of make()) { yield x; break; }
    return "broken off";
}
async function* collectsWithoutYielding(make: () => Iterable<unknown>): AsyncGenerator<unknown, string, unknown> {
    const all: unknown[] = [];
    for await (const x of make()) all.push(x);
    yield all;
    return "collected";
}
async function inAFunction(make: () => Iterable<unknown>): Promise<void> {
    try {
        for await (const x of make()) note("function got " + JSON.stringify(x));
        note("the function's loop is over");
    } catch (error) {
        note("function caught " + (error as Error).message);
    }
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
    await scene(kind + ", a loop", () => byLoop(loops(make)));
    await scene(kind + ", a loop, resumed", () => resumed(() => byLoop(loops(make))));
    await scene(kind + ", a loop beside jobs", () => Promise.all([ticker("t", 14), byLoop(loops(make))]));
    await scene(kind + ", a loop, resumed beside jobs", () => Promise.all([resumed(() => byLoop(loops(make))), ticker("t", 16)]));
    await scene(kind + ", next", () => resumed(() => byNext(loops(make))));
    await scene(kind + ", twice", () => resumed(() => byLoop(loopsTwice(make))));
    await scene(kind + ", behind a wait", () => byLoop(loopsBehindAWait(make)));
    await scene(kind + ", broken off", () => resumed(() => byLoop(breaksOff(make))));
    await scene(kind + ", collected", () => resumed(() => byLoop(collectsWithoutYielding(make))));
    await scene(kind + ", in a function", () => inAFunction(make));
    await scene(kind + ", in a function, resumed", () => resumed(() => inAFunction(make)));
    await scene(kind + ", in a function beside jobs", () => Promise.all([ticker("t", 10), resumed(() => inAFunction(make))]));
    await scene(kind + ", thrown into", () => resumed(() => thrownInto(loops(make))));
    await scene(kind + ", returned into", () => resumed(() => returnedInto(loops(make))));
    await scene(kind + ", two at once", () => Promise.all([byLoop(loops(make)), byLoop(loops(make))]));
}
console.log(lines.join("\n"));
