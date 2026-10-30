// The body of an async generator throws while `for await` or `yield*` of the program steps it: ahead of the first yield, between yields, behind an await that goes on in place and behind
// one that waits, in a finally at the end of the stream and in a finally that a `break` or a throw of the loop's body runs. What is thrown: an error, undefined, null, zero, a thenable, a
// promise, an iterator result. The loop stands in a try, in a catch, in a finally, under a finally alone and under no handler at all, in an async function and in an async generator.
// A chain of `then` callbacks beside every run shows in which turn of the job queue the handler runs. Afterwards the generator is completed: next(), return() and throw() say so.
// At the end: generators that recurse until the stack is full, and a thousand streams in a row that end in a throw.
type Numbers = AsyncGenerator<number, any, unknown>;
type Consumer = (label: string, source: Numbers) => Promise<unknown>;
let log: string[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (value instanceof Promise) return "a promise";
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
const anError = (): unknown => new RangeError("thrown by the producer");

async function* throwsAt(at: number, make: () => unknown, where: string): Numbers {
    note("the producer starts");
    for (let i = 0; ; i++) {
        if (i === at) {
            if (where === "behind an await") await null;
            if (where === "behind a wait") await outside();
            note("the producer throws");
            throw make();
        }
        note("yields " + i);
        yield i;
    }
}
async function* throwsInFinally(n: number, where: string): Numbers {
    try {
        for (let i = 0; i < n; i++) { note("yields " + i); yield i; }
    } finally {
        if (where === "behind an await") await null;
        if (where === "behind a wait") await outside();
        note("the finally throws");
        throw new RangeError("thrown in the finally");
    }
}
async function* throwsThroughFinally(at: number): Numbers {
    try {
        try {
            for (let i = 0; ; i++) { if (i === at) throw new RangeError("thrown under two finallys"); yield i; }
        } finally {
            note("the inner finally");
            await null;
            note("the inner finally goes on");
        }
    } finally {
        note("the outer finally");
        await outside();
        note("the outer finally goes on");
    }
}
async function* throwsInACall(at: number): Numbers {
    const fail = (depth: number): number => { if (depth === 0) throw new RangeError("thrown three calls down"); return fail(depth - 1) + 1; };
    for (let i = 0; ; i++) yield i === at ? fail(3) : i;
}
async function* passesOn(label: string, source: Numbers): Numbers {
    try {
        for await (const x of source) { note(label + " relays " + x); yield x; }
    } finally {
        note(label + "'s finally");
        await null;
        note(label + "'s finally goes on");
    }
}
async function* catchesAndGoesOn(label: string, source: Numbers): Numbers {
    try {
        for await (const x of source) yield x;
    } catch (error) {
        note(label + " caught " + show(error));
        yield -1;
        note(label + " goes on");
    }
    yield -2;
}
async function* throwsSomethingElse(label: string, source: Numbers): Numbers {
    try {
        for await (const x of source) yield x;
    } catch (error) {
        note(label + " caught " + show(error));
        throw new TypeError("thrown by " + label + " in its place");
    }
}
async function* forwards(source: Numbers): Numbers {
    return yield* source;
}
async function* forwardsAndCatches(label: string, source: Numbers): Numbers {
    try {
        yield* source;
    } catch (error) {
        note(label + " caught " + show(error));
        yield -1;
    }
}

async function inATry(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        for await (const x of source) note(label + " got " + x);
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    } finally {
        note(label + "'s finally");
    }
}
async function inATryInItsFirstRun(label: string, source: Numbers): Promise<void> {
    try {
        for await (const x of source) note(label + " got " + x);
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    } finally {
        note(label + "'s finally");
    }
}
async function inACatch(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        throw new Error("the first error");
    } catch (first) {
        try {
            for await (const x of source) note(label + " got " + x);
            note(label + " is through");
        } catch (error) {
            note(label + " caught " + show(error) + " while it handled " + show(first));
        }
    }
}
async function inAFinally(label: string, source: Numbers): Promise<string> {
    await null;
    try {
        return label + " returned from its try";
    } finally {
        try {
            for await (const x of source) note(label + " got " + x);
            note(label + " is through");
        } catch (error) {
            note(label + " caught " + show(error));
        }
    }
}
async function underAFinallyAlone(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        for await (const x of source) note(label + " got " + x);
        note(label + " is through");
    } finally {
        note(label + "'s finally");
        await null;
        note(label + "'s finally goes on");
    }
}
async function underNoHandler(label: string, source: Numbers): Promise<void> {
    await null;
    for await (const x of source) note(label + " got " + x);
    note(label + " is through");
}
async function inTwoLoops(label: string, source: Numbers): Promise<void> {
    await null;
    for (let round = 0; round < 2; round++) {
        try {
            for await (const x of source) note(label + " got " + x + " in round " + round);
            note(label + " is through round " + round);
        } catch (error) {
            note(label + " caught " + show(error) + " in round " + round);
        }
    }
}
async function leavesAtOne(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        for await (const x of source) { note(label + " got " + x); if (x === 1) break; }
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    }
}
async function throwsAtOne(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        for await (const x of source) { note(label + " got " + x); if (x === 1) throw new Error("thrown by the loop's body"); }
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    }
}
async function awaitedByAnother(label: string, source: Numbers): Promise<void> {
    await null;
    try {
        await underNoHandler(label, source);
        note(label + "'s caller goes on");
    } catch (error) {
        note(label + "'s caller caught " + show(error));
    }
}

async function afterwards(source: Numbers): Promise<void> {
    note("afterwards next " + show(await source.next()));
    note("return " + show(await source.return("asked to return")));
    try {
        note("throw " + show(await source.throw(new Error("thrown at a completed generator"))));
    } catch (error) {
        note("throw gave back " + show(error));
    }
    note("next " + show(await source.next()));
}
async function scene(title: string, consume: Consumer, make: () => Numbers): Promise<void> {
    for (const company of ["alone", "behind jobs", "ahead of jobs"]) {
        log = [];
        const source = make();
        const ahead = company === "behind jobs" ? ticker("t", 12) : undefined;
        const ended = consume("a", source).then(value => note("a's promise is fulfilled with " + show(value)), error => note("a's promise is rejected with " + show(error)));
        note("back in the scene");
        const behind = company === "ahead of jobs" ? ticker("t", 12) : undefined;
        await ended;
        await ahead;
        await behind;
        await afterwards(source);
        out.push(title + ", " + company + ": " + log.join(" | "));
    }
}

const consumers: [string, Consumer][] = [
    ["in a try", inATry],
    ["in a try, in its first run", inATryInItsFirstRun],
    ["in a catch", inACatch],
    ["in a finally", inAFinally],
    ["under a finally alone", underAFinallyAlone],
    ["under no handler", underNoHandler],
    ["in two loops", inTwoLoops],
    ["awaited by another function", awaitedByAnother],
];
for (const [how, consume] of consumers) {
    for (const at of [0, 2]) {
        for (const where of ["", "behind an await", "behind a wait"])
            await scene("thrown at step " + at + (where && ", " + where) + ", the loop " + how, consume, () => throwsAt(at, anError, where));
    }
    await scene("thrown through two finallys, the loop " + how, consume, () => throwsThroughFinally(1));
    await scene("thrown three calls down, the loop " + how, consume, () => throwsInACall(1));
    await scene("thrown in the finally at the end, the loop " + how, consume, () => throwsInFinally(2, ""));
}

const thrown: [string, () => unknown][] = [
    ["undefined", () => undefined],
    ["null", () => null],
    ["zero", () => 0],
    ["a string", () => "a word"],
    ["a record", () => ({ code: 7 })],
    ["a thenable", () => ({ then(resolve: (value: string) => void): void { note("THE THROWN THENABLE IS ASKED"); resolve("adopted"); } })],
    ["a promise", () => Promise.resolve("inside")],
    ["an iterator result of the engine", () => [7][Symbol.iterator]().next()],
    ["an iterator result that says done", () => [][Symbol.iterator]().next()],
    ["something that looks like an iterator result", () => ({ value: 8, done: false })],
];
for (const [what, make] of thrown) {
    for (const at of [0, 1]) {
        await scene(what + " thrown at step " + at, inATry, () => throwsAt(at, make, ""));
        await scene(what + " thrown at step " + at + " under for await", inATry, () => passesOn("r", throwsAt(at, make, "")));
        await scene(what + " thrown at step " + at + " under yield*", underNoHandler, () => forwards(throwsAt(at, make, "")));
    }
}

for (const where of ["", "behind an await", "behind a wait"]) {
    const title = "a finally that throws" + (where && " " + where);
    await scene(title + ", over nothing", inATry, () => throwsInFinally(0, where));
    await scene(title + ", at the end", inATry, () => throwsInFinally(2, where));
    await scene(title + ", at the end, under no handler", underNoHandler, () => throwsInFinally(1, where));
    await scene(title + ", at a break", leavesAtOne, () => throwsInFinally(4, where));
    await scene(title + ", at a throw of the loop's body", throwsAtOne, () => throwsInFinally(4, where));
    await scene(title + ", at a break, under for await", leavesAtOne, () => passesOn("r", throwsInFinally(4, where)));
    await scene(title + ", at a break, under yield*", leavesAtOne, () => forwards(throwsInFinally(4, where)));
}

const chains: [string, () => Numbers][] = [
    ["for await passes it on", () => passesOn("r", throwsAt(1, anError, ""))],
    ["two pass it on", () => passesOn("s", passesOn("r", throwsAt(1, anError, "")))],
    ["two pass on what is thrown at once", () => passesOn("s", passesOn("r", throwsAt(0, anError, "")))],
    ["two pass on what is thrown behind a wait", () => passesOn("s", passesOn("r", throwsAt(1, anError, "behind a wait")))],
    ["yield* passes it on", () => forwards(throwsAt(1, anError, ""))],
    ["yield* twice", () => forwards(forwards(throwsAt(1, anError, "behind an await")))],
    ["the middle catches and goes on", () => passesOn("s", catchesAndGoesOn("r", throwsAt(1, anError, "")))],
    ["the middle catches what is thrown at once", () => passesOn("s", catchesAndGoesOn("r", throwsAt(0, anError, "")))],
    ["the middle catches under yield*", () => forwards(forwardsAndCatches("f", throwsAt(1, anError, "")))],
    ["the middle throws something else", () => passesOn("s", throwsSomethingElse("r", throwsAt(1, anError, "")))],
    ["the top catches", () => catchesAndGoesOn("s", passesOn("r", throwsThroughFinally(1)))],
];
for (const [title, make] of chains) {
    for (const [how, consume] of [consumers[0], consumers[1], consumers[5]]) await scene(title + ", the loop " + how, consume, make);
}

// Each body steps another generator of its kind until the stack is full: the last step finds no room for the body it has already asked. How deep that is differs from one way of running
// the program to the other, and so does the number of turns the error takes on its way up, so no turns are noted here.
async function* recursesWithForAwait(): Numbers {
    for await (const x of recursesWithForAwait()) yield x;
}
async function* recursesWithYieldStar(): Numbers {
    yield* recursesWithYieldStar();
}
async function fillsTheStack(source: Numbers, isResumedFirst: boolean): Promise<string> {
    if (isResumedFirst) await null;
    try {
        for await (const x of source) note("GOT " + x);
        return "the loop is through";
    } catch (error) {
        return "caught " + (error instanceof RangeError ? "a RangeError" : show(error)) + ", afterwards next " + show(await source.next());
    }
}
for (const isResumedFirst of [true, false]) {
    const how = isResumedFirst ? "" : ", the loop in its first run";
    out.push("for await until the stack is full" + how + ": " + (await fillsTheStack(recursesWithForAwait(), isResumedFirst)));
    out.push("yield* until the stack is full" + how + ": " + (await fillsTheStack(recursesWithYieldStar(), isResumedFirst)));
}

// Many streams that end in a throw, one behind the other and all in place: what one leaves behind would show in the next.
async function countsCaught(rounds: number): Promise<string> {
    await null;
    let sum = 0, caught = 0;
    for (let round = 0; round < rounds; round++) {
        try {
            for await (const x of quietlyThrowsAt(round % 5)) sum += x;
        } catch (error) {
            if (error instanceof RangeError) caught++;
        }
    }
    return "sum " + sum + ", caught " + caught;
}
async function* quietlyThrowsAt(at: number): Numbers {
    for (let i = 0; ; i++) { if (i === at) throw new RangeError("quietly"); yield i; }
}
out.push("a thousand streams that end in a throw: " + (await countsCaught(1000)));
console.log(out.join("\n"));
export {};
