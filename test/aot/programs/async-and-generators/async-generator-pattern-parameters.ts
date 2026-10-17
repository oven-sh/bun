// An async generator whose parameters are patterns or have defaults binds them when it is called: what goes wrong there is thrown by the call, and no generator is made. What goes wrong
// later, in the body, rejects the step. Both, for every way of consuming: `for await`, `yield*`, next() written out, return() and throw() ahead of the first next(); sources that wait and
// that do not; chains of such generators; alone, beside other jobs with a ticker that shows every turn, and two at once.
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
interface Options { count: number; label?: string; waits?: boolean; failsAt?: number; }
type Stream = AsyncGenerator<unknown, unknown, unknown>;
function said<T>(text: string, value: T): T {
    note(text);
    return value;
}
function fails(text: string): never {
    throw new Error(text);
}
async function* byPattern({ count, label = said("default label", "p"), waits = false, failsAt = -1 }: Options): Stream {
    note(label + " starts");
    for (let i = 0; i < count; i++) {
        if (waits) await outside();
        if (i === failsAt) throw new Error(label + " fails at " + i);
        yield { label, i };
    }
    return label + " is over";
}
async function* byDefault(count: number = said("default count", 2), label: string = said("default label of " + count, "d" + count)): Stream {
    note(label + " starts");
    for (let i = 0; i < count; i++) yield label + i;
    return label + " is over";
}
async function* byArrayPattern([first, second = said("default second", "s")]: string[], ...rest: number[]): Stream {
    yield first;
    await outside();
    yield second;
    yield rest.length;
    return rest;
}
async function* forwardsByPattern({ inner, label = "f" }: { inner: Stream; label?: string }): Stream {
    note(label + " forwards");
    const result = yield* inner;
    note(label + " got " + JSON.stringify(result));
    return result;
}
async function* loopsByPattern({ inner, factor = 10 }: { inner: AsyncGenerator<unknown>; factor?: number }): Stream {
    let n = 0;
    for await (const x of inner) yield [factor * ++n, x];
    return n;
}
async function* pullsByPattern({ inner }: { inner: Stream }): Stream {
    for (;;) {
        const step = await inner.next();
        if (step.done) return step.value;
        yield step.value;
    }
}
async function* closesOver({ base }: { base: number }, add: () => number = () => base + 1): Stream {
    yield add();
    base = 40;
    yield add();
    return base;
}
class Holder {
    constructor(private name: string) {}
    async *stream({ count }: { count: number }, suffix: string = this.name + "!"): Stream {
        for (let i = 0; i < count; i++) yield this.name + i + suffix;
        return arguments.length;
    }
}
function called(title: string, make: () => Stream): Stream | null {
    try {
        const stream = make();
        note(title + ": made");
        return stream;
    } catch (error) {
        note(title + ": the call threw " + (error instanceof TypeError ? "a TypeError" : (error as Error).message));
        return null;
    }
}
async function loopOver(stream: Stream | null): Promise<void> {
    if (!stream) return;
    try {
        for await (const x of stream) note("got " + JSON.stringify(x));
        note("the loop is over");
    } catch (error) {
        note("caught " + (error instanceof TypeError ? "a TypeError" : (error as Error).message));
    }
    note("then " + JSON.stringify(await stream.next()));
}
async function pull(stream: Stream | null): Promise<void> {
    if (!stream) return;
    try {
        for (let i = 0; i < 9; i++) {
            const step = await stream.next(i);
            note((step.done ? "done " : "step ") + JSON.stringify(step.value));
            if (step.done) break;
        }
    } catch (error) {
        note("caught " + (error instanceof TypeError ? "a TypeError" : (error as Error).message));
    }
    note("then " + JSON.stringify(await stream.next()));
}
const throwingGetter = { get count(): number { return fails("the getter of count"); } };
const makers: [string, () => Stream][] = [
    ["pattern", () => byPattern({ count: 3 })],
    ["pattern that waits", () => byPattern({ count: 3, label: "w", waits: true })],
    ["pattern, the body fails at once", () => byPattern({ count: 2, label: "b0", failsAt: 0 })],
    ["pattern, the body fails later", () => byPattern({ count: 3, label: "b1", failsAt: 1 })],
    ["pattern, the body fails behind a wait", () => byPattern({ count: 3, label: "b2", waits: true, failsAt: 2 })],
    ["pattern of null", () => byPattern(null as unknown as Options)],
    ["pattern of undefined", () => (byPattern as unknown as () => Stream)()],
    ["pattern with a getter that throws", () => byPattern(throwingGetter)],
    ["pattern with a default that throws", () => byPattern({ count: 1, get label(): undefined { note("label is read"); return undefined; }, get waits(): boolean { return fails("the getter of waits"); } })],
    ["defaults", () => byDefault()],
    ["defaults, one given", () => byDefault(1)],
    ["defaults, both given", () => byDefault(1, "given")],
    ["defaults, undefined given", () => byDefault(undefined, undefined)],
    ["array pattern", () => byArrayPattern(["a"], 1, 2, 3)],
    ["array pattern of what cannot be iterated", () => byArrayPattern(JSON.parse("5"))],
    ["forwards", () => forwardsByPattern({ inner: byPattern({ count: 2, label: "in" }) })],
    ["forwards what waits", () => forwardsByPattern({ inner: byPattern({ count: 2, label: "inw", waits: true }) })],
    ["forwards twice", () => forwardsByPattern({ label: "outer", inner: forwardsByPattern({ label: "middle", inner: byPattern({ count: 2, label: "deep", waits: true }) }) })],
    ["forwards what fails", () => forwardsByPattern({ inner: byPattern({ count: 3, label: "inf", waits: true, failsAt: 1 }) })],
    ["loops", () => loopsByPattern({ inner: byPattern({ count: 2, label: "lo" }) })],
    ["loops over what waits", () => loopsByPattern({ factor: 2, inner: byPattern({ count: 2, label: "low", waits: true }) })],
    ["loops over what fails", () => loopsByPattern({ inner: byPattern({ count: 2, label: "lof", failsAt: 1 }) })],
    ["pulls", () => pullsByPattern({ inner: byPattern({ count: 2, label: "pu" }) })],
    ["pulls what waits", () => pullsByPattern({ inner: byPattern({ count: 2, label: "puw", waits: true }) })],
    ["pulls what fails", () => pullsByPattern({ inner: byPattern({ count: 2, label: "puf", waits: true, failsAt: 1 }) })],
    ["all three", () => loopsByPattern({ inner: forwardsByPattern({ inner: pullsByPattern({ inner: byPattern({ count: 3, label: "all", waits: true }) }) }) })],
    ["closes over", () => closesOver({ base: 1 })],
    ["a method", () => new Holder("h").stream({ count: 2 })],
    ["a method, pattern of null", () => new Holder("h").stream(null as unknown as { count: number })],
];
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = [];
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [title, make] of makers) {
    await scene(title + ", for await", () => loopOver(called(title, make)));
    await scene(title + ", next", () => pull(called(title, make)));
    await scene(title + ", for await beside jobs", () => Promise.all([ticker("t", 14), loopOver(called(title, make))]));
    await scene(title + ", next beside jobs", () => Promise.all([ticker("t", 14), pull(called(title, make))]));
    await scene(title + ", two at once", () => Promise.all([loopOver(called(title, make)), pull(called(title, make))]));
    await scene(title + ", return ahead of next", async () => {
        const stream = called(title, make);
        if (!stream) return;
        note(JSON.stringify(await stream.return("returned")));
        note(JSON.stringify(await stream.next()));
    });
    await scene(title + ", return of a promise ahead of next, beside jobs", async () => {
        const stream = called(title, make);
        if (!stream) return;
        await Promise.all([ticker("t", 6), stream.return(outside().then(() => "late")).then(step => note(JSON.stringify(step)))]);
    });
    await scene(title + ", throw ahead of next", async () => {
        const stream = called(title, make);
        if (!stream) return;
        try { note(JSON.stringify(await stream.throw(new Error("thrown in")))); } catch (error) { note("caught " + (error as Error).message); }
        note(JSON.stringify(await stream.next()));
    });
    await scene(title + ", three asked for at once", async () => {
        const stream = called(title, make);
        if (!stream) return;
        const steps = await Promise.allSettled([stream.next(), stream.next(), stream.next()]);
        note(steps.map(one => one.status === "fulfilled" ? JSON.stringify(one.value) : "rejected " + one.reason.message).join(" & "));
    });
}
await scene("nothing of the body runs ahead of next", async () => {
    const stream = byPattern({ count: 1, label: "quiet" });
    note("made");
    await outside();
    note("waited");
    note(JSON.stringify(await stream.next()));
});
await scene("the call that throws leaves jobs as they are", async () => {
    const ticks = ticker("t", 4);
    called("of null", () => byPattern(null as unknown as Options));
    await ticks;
});
await scene("a call that throws inside a body rejects that body's step", () => loopOver((async function* ({ n }: { n: number }): Stream {
    yield n;
    yield* byPattern(null as unknown as Options);
    yield "not reached";
    return n;
})({ n: 1 })));
await scene("a call that throws inside a body is caught there", () => loopOver((async function* ({ n }: { n: number }): Stream {
    try {
        yield* byPattern(throwingGetter);
    } catch (error) {
        yield "caught inside: " + (error as Error).message;
    }
    yield n;
    return n;
})({ n: 2 })));
console.log(lines.join("\n"));
