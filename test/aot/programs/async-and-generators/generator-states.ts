// Every state a generator or an async generator can be asked in: not started, suspended at a yield, running, completed.
function* count(limit: number): Generator<number, string, number | undefined> {
    let sent: number | undefined;
    try {
        for (let i = 0; i < limit; i++)
            sent = yield i + (sent ?? 0);
        return "finished";
    } finally {
        console.log("count: finally");
    }
}

function show(label: string, step: IteratorResult<unknown, unknown>): void {
    console.log(label, String(step.value), step.done);
}

function attempt(label: string, action: () => IteratorResult<unknown, unknown>): void {
    try {
        show(label, action());
    } catch (error) {
        console.log(label, "threw", error instanceof Error ? error.constructor.name + ": " + error.message : String(error));
    }
}

{
    const notStarted = count(3);
    attempt("return before the start", () => notStarted.return("early"));
    attempt("next after that", () => notStarted.next());
    attempt("throw after that", () => notStarted.throw(new RangeError("late")));
}
{
    const notStarted = count(3);
    attempt("throw before the start", () => notStarted.throw(new RangeError("at once")));
    attempt("next after that", () => notStarted.next());
    attempt("return after that", () => notStarted.return("again"));
}
{
    const running = count(2);
    attempt("first", () => running.next());
    attempt("second", () => running.next(10));
    attempt("third", () => running.next(20));
    attempt("fourth", () => running.next(30));
}
{
    const stopped = count(5);
    attempt("first", () => stopped.next());
    attempt("return at a yield", () => stopped.return("stopped"));
    attempt("next after that", () => stopped.next());
}
{
    const broken = count(5);
    attempt("first", () => broken.next());
    attempt("throw at a yield", () => broken.throw(new TypeError("broken")));
    attempt("next after that", () => broken.next());
}
{
    let self: Generator<number, void, unknown>;
    function* reentrant(): Generator<number, void, unknown> {
        attempt("next while running", () => self.next());
        attempt("return while running", () => self.return());
        yield 1;
    }
    self = reentrant();
    attempt("outer next", () => self.next());
    attempt("outer next again", () => self.next());
}
{
    let total = 0;
    for (let round = 0; round < 50; round++) {
        const iterator = count(4);
        let step = iterator.next();
        while (!step.done) {
            total += step.value;
            step = iterator.next(round);
        }
        total += step.value.length;
    }
    console.log("driven by hand", total);
}

async function* ticks(limit: number): AsyncGenerator<number, string, unknown> {
    try {
        for (let i = 0; i < limit; i++) {
            await null;
            yield i;
        }
        return "over";
    } finally {
        console.log("ticks: finally");
    }
}

async function attemptAsync(label: string, action: () => Promise<IteratorResult<unknown, unknown>>): Promise<void> {
    try {
        show(label, await action());
    } catch (error) {
        console.log(label, "rejected", error instanceof Error ? error.constructor.name + ": " + error.message : String(error));
    }
}

async function main(): Promise<void> {
    {
        const notStarted = ticks(3);
        await attemptAsync("async: return before the start", () => notStarted.return("early"));
        await attemptAsync("async: next after that", () => notStarted.next());
    }
    {
        const notStarted = ticks(3);
        await attemptAsync("async: throw before the start", () => notStarted.throw(new RangeError("at once")));
        await attemptAsync("async: next after that", () => notStarted.next());
    }
    {
        const notStarted = ticks(3);
        await attemptAsync("async: return of a promise before the start", () => notStarted.return(Promise.resolve("later") as any));
        await attemptAsync("async: return of a rejected promise", () => notStarted.return(Promise.reject(new Error("refused")) as any));
    }
    {
        const queued = ticks(2);
        const steps = [queued.next(), queued.next(), queued.next(), queued.next(), queued.return("closed"), queued.next()];
        for (const [index, step] of (await Promise.all(steps)).entries())
            show("async: queued " + index, step);
    }
    {
        const stopped = ticks(5);
        await attemptAsync("async: first", () => stopped.next());
        await attemptAsync("async: return at a yield", () => stopped.return("stopped"));
        await attemptAsync("async: next after that", () => stopped.next());
    }
    {
        const broken = ticks(5);
        await attemptAsync("async: first", () => broken.next());
        await attemptAsync("async: throw at a yield", () => broken.throw(new TypeError("broken")));
        await attemptAsync("async: next after that", () => broken.next());
    }
    {
        let total = 0;
        for (let round = 0; round < 20; round++) {
            for await (const value of ticks(5))
                total += value + round;
        }
        console.log("async: driven by loops", total);
    }
    {
        let seen = 0;
        for await (const value of ticks(100)) {
            seen += value;
            if (value === 3)
                break;
        }
        console.log("async: left early", seen);
    }
}

main().then(() => console.log("done"));
