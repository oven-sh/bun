// A step of `for await` or `yield*` over an async generator of the program is one call of a stub. While no other job is queued the consumer takes the value in place; beside other jobs a
// step takes the turns of the job queue that it takes in plain Bun. One loop, two and three loops at once, chains of three, a loop in a loop, and jobs that are queued ahead of a stream,
// behind it and in the middle of it, so that a stream changes between the two ways while it runs. Beside every run a chain of `then` callbacks notes the turns: a turn more or less shows.
// At the end the program counts how often the stub left for one of its two operations while a stream was alone.
// CALLS+ consumes StepAsyncGenerator\.InAsyncFunction
// CALLS+ relays StepAsyncGenerator\.InAsyncGenerator
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
type Numbers = AsyncGenerator<number, void, unknown>;
type Texts = AsyncGenerator<string, void, string | undefined>;
let log: string[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function flush(title: string): void {
    out.push(title + ": " + log.join(" | "));
    log = [];
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
function queueJob(text: string): void {
    Promise.resolve().then(() => note(text));
}

async function* counts(label: string, n: number): Numbers {
    note(label + " starts");
    for (let i = 0; i < n; i++) { note(label + " yields " + i); yield i; }
    note(label + " ends");
}
async function* countsAndQueues(label: string, n: number, every: number): Numbers {
    for (let i = 0; i < n; i++) {
        if (i % every === 0) queueJob("job of " + label + " at " + i);
        note(label + " yields " + i);
        yield i;
    }
}
async function* relays(label: string, source: Numbers): Numbers {
    for await (const x of source) { note(label + " relays " + x); yield x; }
    note(label + " ends");
}
async function* relaysAndQueues(label: string, source: Numbers, every: number): Numbers {
    for await (const x of source) {
        if (x % every === 0) queueJob("job of " + label + " at " + x);
        note(label + " relays " + x);
        yield x;
    }
}
async function* forwards(label: string, source: Numbers): Numbers {
    note(label + " forwards");
    yield* source;
    note(label + " ends");
}
async function* echoes(n: number): Texts {
    let sent: string | undefined = "nothing";
    for (let i = 0; i < n; i++) sent = yield "was sent " + sent;
}
async function* forwardsTexts(source: Texts): Texts {
    yield* source;
}

async function consumes(label: string, source: Numbers, isResumedFirst: boolean): Promise<void> {
    if (isResumedFirst) await null;
    for await (const x of source) note(label + " got " + x);
    note(label + " is through");
}
async function consumesAndQueues(label: string, source: Numbers, every: number): Promise<void> {
    await null;
    for await (const x of source) {
        note(label + " got " + x);
        if (x % every === 0) queueJob("job of " + label + " at " + x);
    }
    note(label + " is through");
}
async function consumesAndAwaits(label: string, source: Numbers): Promise<void> {
    await null;
    for await (const x of source) {
        note(label + " got " + x);
        await null;
        note(label + " went on");
        if (x === 1) { await outside(); note(label + " has waited"); }
    }
    note(label + " is through");
}
async function consumesRows(label: string, rows: number, columns: number): Promise<void> {
    await null;
    for await (const row of counts(label + "r", rows)) {
        for await (const column of counts(label + "c", columns)) note(label + " got " + row + "," + column);
    }
    note(label + " is through");
}
async function sends(label: string): Promise<void> {
    await null;
    const chain = forwardsTexts(forwardsTexts(echoes(4)));
    for (const text of ["a", "b", "c", "d", "e", "f"]) {
        const step = await chain.next(text);
        note(label + " got " + String(step.value) + (step.done ? ", done" : ""));
    }
}

const scenes: [string, () => Promise<void>[]][] = [
    ["one loop", () => [consumes("a", counts("p", 4), true)]],
    ["one loop in its first run", () => [consumes("a", counts("p", 4), false)]],
    ["one loop over nothing", () => [consumes("a", counts("p", 0), true)]],
    ["two loops", () => [consumes("a", counts("p", 3), true), consumes("b", counts("q", 3), true)]],
    ["two loops, the second in its first run", () => [consumes("a", counts("p", 3), true), consumes("b", counts("q", 3), false)]],
    ["a short loop and a long one", () => [consumes("a", counts("p", 1), true), consumes("b", counts("q", 6), true)]],
    ["three loops", () => [consumes("a", counts("p", 2), true), consumes("b", counts("q", 3), true), consumes("c", counts("r", 2), false)]],
    ["a chain of three by for await", () => [consumes("a", relays("s", relays("r", counts("p", 3))), true)]],
    ["a chain of three by yield*", () => [consumes("a", forwards("g", forwards("f", counts("p", 3))), true)]],
    ["a chain of three, for await over yield*", () => [consumes("a", relays("r", forwards("f", counts("p", 3))), true)]],
    ["a chain of three, yield* over for await", () => [consumes("a", forwards("f", relays("r", counts("p", 3))), true)]],
    ["a chain of three in its first run", () => [consumes("a", relays("s", relays("r", counts("p", 3))), false)]],
    ["two chains of three", () => [consumes("a", relays("s", relays("r", counts("p", 2))), true), consumes("b", forwards("g", forwards("f", counts("q", 2))), true)]],
    ["a chain of three and a loop", () => [consumes("a", relays("s", forwards("f", counts("p", 2))), true), consumes("b", counts("q", 5), true)]],
    ["the producer queues a job at every other step", () => [consumes("a", countsAndQueues("p", 6, 2), true)]],
    ["the producer queues a job at every step", () => [consumes("a", countsAndQueues("p", 4, 1), true)]],
    ["the consumer queues a job at every other step", () => [consumesAndQueues("a", counts("p", 6), 2)]],
    ["the middle of a chain queues a job at every other step", () => [consumes("a", relays("s", relaysAndQueues("r", counts("p", 4), 2)), true)]],
    ["the end of a chain queues a job at every other step", () => [consumes("a", forwards("g", relays("r", countsAndQueues("p", 4, 2))), true)]],
    ["the consumer awaits between steps", () => [consumesAndAwaits("a", counts("p", 4))]],
    ["a loop in a loop", () => [consumesRows("a", 2, 2)]],
    ["two loops in loops", () => [consumesRows("a", 2, 1), consumesRows("b", 1, 2)]],
    ["what is sent goes down a chain of three", () => [sends("a")]],
];
const companies: [string, number, number][] = [["alone", 0, 0], ["behind three jobs", 3, 0], ["behind many jobs", 45, 0], ["ahead of three jobs", 0, 3], ["ahead of many jobs", 0, 45]];
for (const [title, start] of scenes) {
    for (const [company, ahead, behind] of companies) {
        // A settled promise in the list would queue a job of its own, and the stream would not be alone.
        const all: Promise<void>[] = [];
        if (ahead) all.push(ticker("t", ahead));
        all.push(...start());
        note("back in the module");
        if (behind) all.push(ticker("t", behind));
        await Promise.all(all);
        flush(title + ", " + company);
    }
}

const operations = ["operationAOTAsyncIteratorStep", "operationAOTFinishAsyncIteratorStep"];
function entries(): number[] {
    return operations.map(name => (counted ? counted(name) : 0));
}
async function* quiet(n: number): Numbers { for (let i = 0; i < n; i++) yield i; }
async function* quietRelay(source: Numbers): Numbers { for await (const x of source) yield x; }
async function* quietForward(source: Numbers): Numbers { yield* source; }
async function sumOf(source: Numbers, jobsAtTheStart: number): Promise<number> {
    await null;
    const beside = jobsAtTheStart ? ticker("t", jobsAtTheStart) : undefined;
    let sum = 0;
    for await (const x of source) sum += x;
    await beside;
    return sum;
}
async function sumOfRows(rows: number, columns: number): Promise<number> {
    await null;
    let sum = 0;
    for await (const row of quiet(rows)) {
        for await (const column of quiet(columns)) sum += row * column;
    }
    return sum;
}
async function measure(title: string, steps: number, run: () => Promise<number>): Promise<void> {
    const before = entries();
    const sum = await run();
    const after = entries();
    const verdicts = operations.map((name, i) => {
        const entered = after[i] - before[i];
        return entered * 20 < steps ? "few entries of " + name : entered + " ENTRIES OF " + name + " IN " + steps + " STEPS";
    });
    out.push(title + ": sum " + sum + ", " + verdicts.join(", "));
    log = [];
}
const N = 2000;
for (let round = 0; round < 2; round++) {
    await measure("one loop", N, () => sumOf(quiet(N), 0));
    await measure("a chain of three by for await", 3 * N, () => sumOf(quietRelay(quietRelay(quiet(N))), 0));
    await measure("a chain of three by yield*", 3 * N, () => sumOf(quietForward(quietForward(quiet(N))), 0));
    await measure("a chain of three, for await over yield*", 3 * N, () => sumOf(quietRelay(quietForward(quiet(N))), 0));
    await measure("a chain of three, yield* over for await", 3 * N, () => sumOf(quietForward(quietRelay(quiet(N))), 0));
    await measure("a loop in a loop", 40 * 50, () => sumOfRows(40, 50));
    await measure("one loop with five jobs at its start", N, () => sumOf(quiet(N), 5));
    await measure("a chain of three with five jobs at its start", 3 * N, () => sumOf(quietRelay(quietForward(quiet(N))), 5));
}
console.log(out.join("\n"));
export {};
