// While `for await` or `yield*` of the program steps an async generator, the generator is asked again: by its own body, which calls its own next(), return() or throw(), once or several
// times, at the first step or at a later one, ahead of an await or behind it, and then goes on, throws or returns; by a second loop that joins in the middle of the stream; by hand from the
// loop's own body; by a job from outside while the body waits. Every request queues behind the step in progress and is answered in its turn, and the loop gets what is left.
// Beside every run a chain of `then` callbacks notes the turns of the job queue.
type Numbers = AsyncGenerator<number, unknown, unknown>;
type Ask = (self: Numbers) => void;
interface Cell { self?: Numbers; }
let log: string[] = [];
let answers: Promise<void>[] = [];
const out: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
// Runs in the job of that turn.
function runInTurn(turn: number, run: () => void): void {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i < turn; i++) last = last.then(() => undefined);
    answers.push(last.then(run));
}
function watch(label: string, request: Promise<IteratorResult<number, unknown>>): void {
    answers.push(request.then(result => note(label + " is answered " + show(result)), error => note(label + " is rejected " + show(error))));
}

async function* asksItself(cell: Cell, at: number, ask: Ask, where: string, catches: boolean): Numbers {
    try {
        for (let i = 0; i < 5; i++) {
            if (i === at) {
                if (where === "behind an await") await null;
                if (where === "behind a wait") await outside();
                note("the body asks");
                ask(cell.self!);
                note("the body has asked");
                if (where === "ahead of an await") await null;
                if (where === "ahead of a wait") await outside();
                if (where === "and then throws") throw new RangeError("thrown behind the requests");
                if (where === "and then returns") return "returned behind the requests";
            }
            note("yields " + i);
            const sent = yield i;
            note("behind yield " + i + (sent === undefined ? "" : ", was sent " + show(sent)));
        }
        return "the end";
    } catch (error) {
        if (!catches) throw error;
        note("the body caught " + show(error));
        yield -1;
        return "the end behind the catch";
    } finally {
        note("the body's finally");
    }
}
function makeAsking(at: number, ask: Ask, where: string, catches: boolean): Numbers {
    const cell: Cell = {};
    return (cell.self = asksItself(cell, at, ask, where, catches));
}
async function* counts(n: number): Numbers {
    try {
        for (let i = 0; i < n; i++) { note("yields " + i); yield i; }
        return "the end";
    } finally {
        note("the producer's finally");
    }
}
async function* waitsAheadOfEachYield(n: number): Numbers {
    try {
        for (let i = 0; i < n; i++) { note("waits " + i); await outside(); note("yields " + i); yield i; }
        return "the end";
    } finally {
        note("the producer's finally");
    }
}
async function* relays(label: string, source: Numbers): Numbers {
    for await (const x of source) { note(label + " relays " + x); yield x; }
    note(label + " ends");
    return label + "'s end";
}
async function* forwards(label: string, source: Numbers): Numbers {
    const returned = yield* source;
    note(label + " was returned " + show(returned));
    return label + "'s end";
}

async function consumes(label: string, source: Numbers, isResumedFirst: boolean): Promise<void> {
    if (isResumedFirst) await null;
    try {
        for await (const x of source) note(label + " got " + x);
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    }
}
async function consumesAndCalls(label: string, source: Numbers, at: number, call: () => void): Promise<void> {
    await null;
    try {
        for await (const x of source) {
            note(label + " got " + x);
            if (x === at) { call(); note(label + " has called"); }
        }
        note(label + " is through");
    } catch (error) {
        note(label + " caught " + show(error));
    }
}
async function consumesAfter(label: string, gate: Promise<void>, source: Numbers): Promise<void> {
    await gate;
    for await (const x of source) note(label + " got " + x);
    note(label + " is through");
}
async function consumesOne(label: string, source: Numbers): Promise<void> {
    for await (const x of source) { note(label + " got " + x + " and leaves"); break; }
    note(label + " is through");
}

async function scene(title: string, start: () => Promise<void>[]): Promise<void> {
    for (const company of ["alone", "behind jobs", "ahead of jobs"]) {
        log = [];
        answers = [];
        const all: Promise<void>[] = [];
        if (company === "behind jobs") all.push(ticker("t", 14));
        all.push(...start());
        note("back in the scene");
        if (company === "ahead of jobs") all.push(ticker("t", 14));
        await Promise.all(all);
        // A request may start another one.
        for (let seen = 0; seen < answers.length; ) { seen = answers.length; await Promise.all(answers); }
        out.push(title + ", " + company + ": " + log.join(" | "));
    }
}

const asks: [string, Ask][] = [
    ["next", self => watch("next", self.next())],
    ["next with a value", self => watch("next", self.next("a word"))],
    ["return", self => watch("return", self.return("returned"))],
    ["return of a promise", self => watch("return", self.return(Promise.resolve("returned by a promise")))],
    ["return of a rejected promise", self => watch("return", self.return(Promise.reject(new RangeError("the returned promise is rejected"))))],
    ["throw", self => watch("throw", self.throw(new RangeError("thrown in")))],
    ["next twice", self => { watch("first", self.next()); watch("second", self.next("second word")); }],
    ["next, return, next", self => { watch("first", self.next()); watch("return", self.return("returned")); watch("last", self.next()); }],
    ["throw, next", self => { watch("throw", self.throw(new RangeError("thrown in"))); watch("next", self.next()); }],
    ["return twice", self => { watch("first", self.return("once")); watch("second", self.return("twice")); }],
    ["six times next", self => { for (let i = 0; i < 6; i++) watch("next " + i, self.next(i)); }],
];
for (const [kind, ask] of asks) {
    for (const at of [0, 2]) {
        const title = "the body asks for " + kind + " at step " + at;
        for (const where of ["", "ahead of an await", "behind an await", "ahead of a wait", "behind a wait", "and then throws", "and then returns"])
            await scene(title + (where && ", " + where), () => [consumes("a", makeAsking(at, ask, where, false), true)]);
        await scene(title + ", and catches", () => [consumes("a", makeAsking(at, ask, "", true), true)]);
        await scene(title + ", the loop in its first run", () => [consumes("a", makeAsking(at, ask, "", false), false)]);
        await scene(title + ", under for await", () => [consumes("a", relays("r", makeAsking(at, ask, "", false)), true)]);
        await scene(title + ", under yield*", () => [consumes("a", forwards("f", makeAsking(at, ask, "", true)), true)]);
    }
}

await scene("a second loop joins in its first run", () => {
    const shared = counts(7);
    return [consumesAndCalls("a", shared, 2, () => answers.push(consumes("b", shared, false)))];
});
await scene("a second loop joins behind an await", () => {
    const shared = counts(7);
    return [consumesAndCalls("a", shared, 2, () => answers.push(consumes("b", shared, true)))];
});
await scene("a second loop that has waited joins", () => {
    const shared = counts(7);
    const gate = Promise.withResolvers<void>();
    return [consumesAfter("b", gate.promise, shared), consumesAndCalls("a", shared, 2, () => gate.resolve())];
});
await scene("a second loop joins, takes one and leaves", () => {
    const shared = counts(7);
    return [consumesAndCalls("a", shared, 2, () => answers.push(consumesOne("b", shared)))];
});
await scene("a second loop joins through a generator", () => {
    const shared = counts(7);
    return [consumesAndCalls("a", shared, 2, () => answers.push(consumes("b", relays("r", shared), true)))];
});
await scene("a second and a third loop join", () => {
    const shared = counts(9);
    return [consumesAndCalls("a", shared, 1, () => { answers.push(consumes("b", shared, false)); answers.push(consumes("c", forwards("f", shared), false)); })];
});
await scene("two loops from the start", () => {
    const shared = counts(6);
    return [consumes("a", shared, true), consumes("b", shared, true)];
});
await scene("two loops from the start over a generator that waits", () => {
    const shared = waitsAheadOfEachYield(4);
    return [consumes("a", shared, true), consumes("b", shared, false)];
});
const byHand: [string, Ask][] = [
    ["next", self => watch("by hand", self.next())],
    ["next three times", self => { for (let i = 0; i < 3; i++) watch("by hand " + i, self.next()); }],
    ["return", self => watch("by hand", self.return("enough"))],
    ["throw", self => watch("by hand", self.throw(new RangeError("thrown by hand")))],
    ["return, next", self => { watch("return", self.return("enough")); watch("next", self.next()); }],
];
for (const [kind, ask] of byHand) {
    await scene("the loop's body asks for " + kind, () => {
        const shared = counts(6);
        return [consumesAndCalls("a", shared, 2, () => ask(shared))];
    });
    await scene("the loop's body asks the end of its chain for " + kind, () => {
        const shared = counts(6);
        return [consumesAndCalls("a", relays("s", forwards("f", shared)), 2, () => ask(shared))];
    });
    for (const turn of [1, 2, 3, 4, 6]) {
        await scene("a job in turn " + turn + " asks for " + kind + " while the body waits", () => {
            const shared = waitsAheadOfEachYield(4);
            runInTurn(turn, () => { note("the job asks"); ask(shared); });
            return [consumes("a", shared, true)];
        });
        await scene("a job in turn " + turn + " asks for " + kind, () => {
            const shared = counts(4);
            runInTurn(turn, () => { note("the job asks"); ask(shared); });
            return [consumes("a", shared, true)];
        });
    }
}
console.log(out.join("\n"));
export {};
