// `for await` over an async generator of the program is the first thing that suspends its function: nothing has saved the function's frame yet, so the first step has nobody to hand its
// value to but a promise, and the steps behind it go the short way. At the top level of a module that has not awaited anything, at the top level later on, and in async functions, arrows,
// methods and generators that are called by the module, by a job, by a timer, by a function that a job has resumed, by the body of a generator that is being stepped, and many at once.
// Streams of several values, of one, of none, streams that throw at once, that wait first, and loops that leave at the first value.
// Beside every run a chain of `then` callbacks notes the turns of the job queue.
type Numbers = AsyncGenerator<number, void, unknown>;
let log: string[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function flush(title: string): void {
    out.push(title + ": " + log.join(" | "));
    log = [];
}
function show(value: unknown): string {
    return value instanceof Error ? value.name + "(" + value.message + ")" : String(value);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
async function* counts(label: string, n: number): Numbers {
    note(label + " starts");
    for (let i = 0; i < n; i++) { note(label + " yields " + i); yield i; }
    note(label + " ends");
}
async function* throwsAtOnce(label: string): Numbers {
    note(label + " throws");
    throw new RangeError("thrown by " + label);
}
async function* waitsFirst(label: string, n: number): Numbers {
    note(label + " waits");
    await outside();
    for (let i = 0; i < n; i++) { note(label + " yields " + i); yield i; }
}
async function* cleansUp(label: string): Numbers {
    try {
        for (let i = 0; ; i++) { note(label + " yields " + i); yield i; }
    } finally {
        note(label + "'s finally");
    }
}

// The module has not been suspended yet.
const besideTheFirstLoop = ticker("t", 8);
for await (const x of counts("p", 3)) note("the module got " + x);
note("the module is through");
await besideTheFirstLoop;
flush("at the top level, the module's first suspension");

for await (const x of counts("p", 3)) note("the module got " + x);
note("the module is through");
flush("at the top level, later, alone");

const besideALaterLoop = ticker("t", 8);
for await (const x of counts("p", 3)) note("the module got " + x);
note("the module is through");
await besideALaterLoop;
flush("at the top level, later, behind jobs");

async function loops(label: string, source: Numbers): Promise<string> {
    let sum = 0;
    for await (const x of source) { note(label + " got " + x); sum += x; }
    note(label + " is through");
    return label + "'s sum is " + sum;
}
const loopsInAnArrow = async (label: string, source: Numbers): Promise<string> => {
    let sum = 0;
    for await (const x of source) { note(label + " got " + x); sum += x; }
    note(label + " is through");
    return label + "'s sum is " + sum;
};
class Reader {
    constructor(private label: string) {}
    async read(source: Numbers): Promise<string> {
        let sum = 0;
        for await (const x of source) { note(this.label + " got " + x); sum += x; }
        note(this.label + " is through");
        return this.label + "'s sum is " + sum;
    }
    static async readAll(label: string, source: Numbers): Promise<string> {
        let sum = 0;
        for await (const x of source) { note(label + " got " + x); sum += x; }
        note(label + " is through");
        return label + "'s sum is " + sum;
    }
}
async function loopsAndCatches(label: string, source: Numbers): Promise<string> {
    try {
        for await (const x of source) note(label + " got " + x);
        return label + " is through";
    } catch (error) {
        note(label + " caught " + show(error));
        return label + " has caught";
    }
}
async function leavesAtOnce(label: string, source: Numbers): Promise<string> {
    for await (const x of source) { note(label + " got " + x + " and leaves"); break; }
    return label + " has left";
}
async function returnsFromTheLoop(label: string, source: Numbers): Promise<string> {
    for await (const x of source) return label + " returns with " + x;
    return label + " got nothing";
}
async function loopsTwice(label: string, first: Numbers, second: Numbers): Promise<string> {
    for await (const x of first) note(label + " got " + x);
    note(label + " is between its loops");
    for await (const x of second) note(label + " then got " + x);
    return label + " is through";
}
async function loopsOverALoop(label: string): Promise<string> {
    for await (const row of counts(label + "r", 2)) {
        for await (const column of counts(label + "c", 2)) note(label + " got " + row + "," + column);
    }
    return label + " is through";
}
async function callsOneThatLoops(label: string, source: Numbers): Promise<string> {
    const result = await loops(label, source);
    note(label + "'s caller goes on");
    return result;
}
async function* relays(label: string, source: Numbers): Numbers {
    for await (const x of source) { note(label + " relays " + x); yield x; }
}
async function* forwards(source: Numbers): Numbers {
    yield* source;
}
async function* startsALoopAtEachStep(label: string, n: number, started: Promise<string>[]): Numbers {
    for (let i = 0; i < n; i++) {
        started.push(loops(label + i, counts("q" + i, 2)));
        note(label + " yields " + i);
        yield i;
    }
}

type Start = (label: string) => Promise<string>;
const starts: [string, Start][] = [
    ["a function", label => loops(label, counts("p", 3))],
    ["an arrow", label => loopsInAnArrow(label, counts("p", 3))],
    ["a method", label => new Reader(label).read(counts("p", 3))],
    ["a static method", label => Reader.readAll(label, counts("p", 3))],
    ["a function over one value", label => loops(label, counts("p", 1))],
    ["a function over nothing", label => loops(label, counts("p", 0))],
    ["a function over what throws at once", label => loopsAndCatches(label, throwsAtOnce("p"))],
    ["a function without a handler over what throws at once", label => loops(label, throwsAtOnce("p"))],
    ["a function over what waits first", label => loops(label, waitsFirst("p", 2))],
    ["a function that leaves at the first value", label => leavesAtOnce(label, cleansUp("p"))],
    ["a function that returns from the loop", label => returnsFromTheLoop(label, cleansUp("p"))],
    ["a function that returns behind an empty loop", label => returnsFromTheLoop(label, counts("p", 0))],
    ["a function with two loops", label => loopsTwice(label, counts("p", 2), counts("q", 2))],
    ["a function with two loops, the first over nothing", label => loopsTwice(label, counts("p", 0), counts("q", 2))],
    ["a function with a loop in a loop", label => loopsOverALoop(label)],
    ["a function over for await", label => loops(label, relays("r", counts("p", 3)))],
    ["a function over yield*", label => loops(label, forwards(counts("p", 3)))],
    ["a function over a chain of three", label => loops(label, relays("r", forwards(counts("p", 2))))],
    ["a function that awaits one that loops", label => callsOneThatLoops(label, counts("p", 2))],
];
function watch(label: string, running: Promise<string>): Promise<void> {
    return running.then(value => note(label + "'s promise: " + value), error => note(label + "'s promise is rejected: " + show(error)));
}
async function resumedThenStarts(start: Start): Promise<void> {
    await null;
    const running = watch("a", start("a"));
    note("back in the function that a job has resumed");
    await null;
    note("that function went on");
    await running;
}
async function resumedThenAwaits(start: Start): Promise<void> {
    await null;
    try {
        note("the caller got: " + (await start("a")));
    } catch (error) {
        note("the caller caught " + show(error));
    }
}
const callers: [string, (start: Start) => Promise<void>][] = [
    ["the module", start => { const running = watch("a", start("a")); note("back in the module"); return running; }],
    ["a job", start => Promise.resolve().then(() => { const running = watch("a", start("a")); note("back in the job"); return running; })],
    ["a job of queueMicrotask", start => new Promise(resolve => { queueMicrotask(() => { watch("a", start("a")).then(resolve); note("back in the job"); }); })],
    ["a timer", start => new Promise(resolve => { setTimeout(() => { watch("a", start("a")).then(resolve); note("back in the timer"); }, 0); })],
    ["a function that a job has resumed", resumedThenStarts],
    ["a function that a job has resumed and that awaits the call", resumedThenAwaits],
    ["the module, three at once", start => { const all = ["a", "b", "c"].map(label => watch(label, start(label))); note("back in the module"); return Promise.all(all).then(() => undefined); }],
];
for (const [what, start] of starts) {
    for (const [who, call] of callers) {
        for (const company of ["alone", "behind jobs", "ahead of jobs"]) {
            const all: Promise<void>[] = [];
            if (company === "behind jobs") all.push(ticker("t", 10));
            all.push(call(start));
            if (company === "ahead of jobs") all.push(ticker("t", 10));
            await Promise.all(all);
            flush(what + ", called by " + who + ", " + company);
        }
    }
}

// The body of a generator that is being stepped starts functions that loop.
for (const isResumedFirst of [false, true]) {
    const started: Promise<string>[] = [];
    const consume = async (): Promise<void> => {
        if (isResumedFirst) await null;
        for await (const x of startsALoopAtEachStep("s", 3, started)) note("a got " + x);
        note("a is through");
    };
    await consume();
    for (const result of await Promise.all(started)) note(result);
    flush("functions that loop, started by the body of a generator whose consumer is " + (isResumedFirst ? "resumed" : "in its first run"));
}

// Every call is a first activation; each saves its frame at its first step.
async function quietSum(n: number): Promise<number> {
    let sum = 0;
    for await (const x of quiet(n)) sum += x;
    return sum;
}
async function* quiet(n: number): Numbers { for (let i = 0; i < n; i++) yield i; }
let total = 0;
for (let round = 0; round < 500; round++) total += await quietSum(round % 7);
const atOnce = await Promise.all(Array.from({ length: 200 }, (_, i) => quietSum(i % 5)));
out.push("five hundred calls in a row: " + total + ", two hundred at once: " + atOnce.reduce((sum, x) => sum + x, 0));
console.log(out.join("\n"));
export {};
