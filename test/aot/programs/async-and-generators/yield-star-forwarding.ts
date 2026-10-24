// `yield*` from one async generator of the program to another: the step that is forwarded awaits nothing. Chains of one to four delegations over sources that wait, do not wait,
// or wait now and then; what the innermost returns comes out as the value of each `yield*`; next(v), throw(e) and return(v) go in to the innermost; who pulls at the top: `for await`,
// next() written out in a function or in a generator, then(); alone, beside other jobs with a ticker that shows every turn of the queue, and two chains at once.
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
const sources: [string, () => Stream][] = [
    ["waits", async function* () { for (let i = 0; i < 3; i++) { await outside(); yield { n: i }; } return "waits is over"; }],
    ["does not wait", async function* () { yield 1; yield "two"; yield { n: 3 }; return "does not wait is over"; }],
    ["waits now and then", async function* () { yield "a"; await outside(); yield "b"; yield "c"; await outside(); return { last: true }; }],
    ["empty", async function* () { return "empty is over"; }],
    ["empty behind a wait", async function* () { await outside(); return "empty behind a wait is over"; }],
    ["listens", async function* () { const first = yield "say something"; await outside(); const second = yield "heard " + JSON.stringify(first); return "last heard " + JSON.stringify(second); }],
    ["cleans up", async function* () { try { await outside(); yield 1; yield 2; return "ran through"; } catch (error) { note("innermost caught " + (error as Error).message); yield 99; return "behind the catch"; } finally { note("innermost finally"); } }],
    ["throws", async function* () { yield 1; await outside(); throw new Error("thrown by the innermost"); }],
    ["queues a job ahead of a yield", async function* () { await outside(); Promise.resolve().then(() => note("the innermost's job")); yield 1; yield 2; }],
    ["yields promises", async function* () { yield Promise.resolve("fulfilled"); yield outside().then(() => "was pending"); }],
];
async function* forwards(inner: Stream, label: string): Stream {
    const returned = yield* inner;
    note(label + " sees " + JSON.stringify(returned));
    return returned;
}
async function* forwardsBetweenItsOwn(inner: Stream): Stream {
    yield "ahead";
    const returned = yield* inner;
    yield "behind";
    return returned;
}
async function* forwardsBehindAWait(inner: Stream): Stream {
    await outside();
    return yield* inner;
}
function chain(make: () => Stream, depth: number): Stream {
    let stream = make();
    for (let i = 1; i <= depth; i++) stream = forwards(stream, "layer " + i);
    return stream;
}
async function byLoop(stream: Stream): Promise<void> {
    try {
        for await (const x of stream) note("got " + JSON.stringify(x));
        note("the loop is over");
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function byNext(stream: Stream): Promise<void> {
    try {
        for (let i = 0; ; i++) {
            const step = await stream.next("sent " + i);
            note((step.done ? "done " : "step ") + JSON.stringify(step.value));
            if (step.done) return;
        }
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function* byNextInAGenerator(stream: Stream): AsyncGenerator<string> {
    try {
        for (;;) {
            const step = await stream.next();
            yield (step.done ? "done " : "step ") + JSON.stringify(step.value);
            if (step.done) return;
        }
    } catch (error) {
        yield "caught " + (error as Error).message;
    }
}
function byThen(stream: Stream): Promise<void> {
    return new Promise(resolve => {
        const pull = (): void => { stream.next().then(step => { note((step.done ? "done " : "step ") + JSON.stringify(step.value)); if (step.done) resolve(); else pull(); }, error => { note("then caught " + error.message); resolve(); }); };
        pull();
    });
}
async function thrownInto(stream: Stream): Promise<void> {
    try {
        note("first " + JSON.stringify(await stream.next()));
        note("thrown into " + JSON.stringify(await stream.throw(new Error("from outside"))));
        note("then " + JSON.stringify(await stream.next()));
        note("then " + JSON.stringify(await stream.next()));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function returnedInto(stream: Stream): Promise<void> {
    try {
        note("first " + JSON.stringify(await stream.next()));
        note("returned into " + JSON.stringify(await stream.return("given up")));
        note("then " + JSON.stringify(await stream.next()));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function severalAtOnce(stream: Stream): Promise<void> {
    const steps = await Promise.allSettled([stream.next(), stream.next(), stream.next(), stream.next(), stream.next()]);
    for (const step of steps) note(step.status === "fulfilled" ? (step.value.done ? "done " : "step ") + JSON.stringify(step.value.value) : "rejected " + step.reason.message);
}
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = [];
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [kind, make] of sources) {
    for (const depth of [1, 2, 4]) {
        await scene(kind + ", " + depth + " deep, a loop", () => byLoop(chain(make, depth)));
        await scene(kind + ", " + depth + " deep, next", () => byNext(chain(make, depth)));
    }
    await scene(kind + ", a loop beside jobs", () => Promise.all([ticker("t", 24), byLoop(chain(make, 2))]));
    await scene(kind + ", next beside jobs", () => Promise.all([ticker("t", 24), byNext(chain(make, 2))]));
    await scene(kind + ", next in a generator", () => byLoop(byNextInAGenerator(chain(make, 2))));
    await scene(kind + ", then", () => byThen(chain(make, 2)));
    await scene(kind + ", between its own", () => byLoop(forwardsBetweenItsOwn(chain(make, 1))));
    await scene(kind + ", behind a wait", () => byNext(forwardsBehindAWait(chain(make, 1))));
    await scene(kind + ", thrown into", () => thrownInto(chain(make, 2)));
    await scene(kind + ", returned into", () => returnedInto(chain(make, 2)));
    await scene(kind + ", several at once", () => severalAtOnce(chain(make, 2)));
    await scene(kind + ", two chains at once", () => Promise.all([byLoop(chain(make, 2)), byNext(chain(make, 3))]));
}
console.log(lines.join("\n"));
