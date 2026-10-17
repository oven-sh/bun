// A promise whose `constructor` getter throws makes `await` throw at once, without a tick:
// in async functions and in async generators, at await, yield, yield* and return, caught and not caught.
const log: string[] = [];
function note(text: string): void {
    log.push(text);
}

function broken(id: string): Promise<number> {
    const promise = Promise.resolve(1);
    Object.defineProperty(promise, "constructor", {
        get() {
            note("constructor of " + id + " is read");
            throw new Error("broken " + id);
        },
    });
    return promise;
}

function tick(id: string): void {
    Promise.resolve().then(() => note("tick " + id));
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function watch(label: string, promise: Promise<unknown>): Promise<void> {
    return promise.then(value => note(label + " resolved " + JSON.stringify(value)), error => note(label + " rejected " + messageOf(error)));
}

async function awaitsInFunction(): Promise<void> {
    tick("f1");
    await broken("f1");
    note("f1 goes on");
}
async function catchesInFunction(): Promise<string> {
    tick("f2");
    try {
        await broken("f2");
    } catch (error) {
        note("f2 caught " + messageOf(error));
    }
    await null;
    return "f2 ends";
}
async function returnsInFunction(): Promise<number> {
    tick("f3");
    return broken("f3");
}
async function awaitsLater(): Promise<string> {
    await null;
    tick("f4");
    try {
        await broken("f4");
    } catch (error) {
        note("f4 caught " + messageOf(error));
    }
    try {
        await broken("f4 again");
    } finally {
        note("f4 finally");
    }
    return "never";
}

async function* awaits(): AsyncGenerator<number> {
    tick("g1");
    await broken("g1");
    note("g1 goes on");
}
async function* catchesAwait(): AsyncGenerator<number> {
    tick("g2");
    try {
        await broken("g2");
    } catch (error) {
        note("g2 caught " + messageOf(error));
    }
    yield 2;
    yield 22;
}
async function* yields(): AsyncGenerator<number> {
    tick("g3");
    yield broken("g3");
    note("g3 goes on");
}
async function* catchesYield(): AsyncGenerator<number> {
    tick("g4");
    try {
        yield broken("g4");
    } catch (error) {
        note("g4 caught " + messageOf(error));
    }
    yield 4;
}
async function* returns(): AsyncGenerator<number, number> {
    tick("g5");
    return broken("g5");
}
async function* catchesReturn(): AsyncGenerator<number, number> {
    tick("g6");
    try {
        return broken("g6");
    } catch (error) {
        note("g6 caught " + messageOf(error));
    }
    return 6;
}
async function* delegates(): AsyncGenerator<number> {
    tick("g7");
    yield* yields();
    note("g7 goes on");
}
async function* catchesDelegate(): AsyncGenerator<number> {
    tick("g8");
    try {
        yield* [1, broken("g8"), 3];
    } catch (error) {
        note("g8 caught " + messageOf(error));
    }
    yield 8;
}
async function* awaitsThenAwaits(): AsyncGenerator<number> {
    try {
        await broken("g9");
    } catch (error) {
        note("g9 caught " + messageOf(error));
    }
    await null;
    yield 9;
    try {
        await broken("g9 again");
    } catch (error) {
        note("g9 caught " + messageOf(error));
        yield 99;
    }
    await broken("g9 at last");
}
async function* plain(): AsyncGenerator<number> {
    yield 1;
    yield 2;
}

async function consume(label: string, source: AsyncGenerator<number, unknown>): Promise<void> {
    try {
        for await (const value of source)
            note(label + " sees " + value);
        note(label + " ends");
    } catch (error) {
        note(label + " caught " + messageOf(error));
    }
}

async function main(): Promise<void> {
    await Promise.all([
        watch("f1", awaitsInFunction()),
        watch("f2", catchesInFunction()),
        watch("f3", returnsInFunction()),
        watch("f4", awaitsLater()),
        watch("g1", awaits().next()),
        watch("g2", catchesAwait().next()),
        watch("g3", yields().next()),
        watch("g4", catchesYield().next()),
        watch("g5", returns().next()),
        watch("g6", catchesReturn().next()),
        watch("g7", delegates().next()),
        watch("g8", catchesDelegate().next()),
        note("all are started"),
    ]);
    note("--- consumed by for await");
    for (const [label, make] of [["g1", awaits], ["g2", catchesAwait], ["g3", yields], ["g4", catchesYield], ["g5", returns], ["g6", catchesReturn], ["g7", delegates], ["g8", catchesDelegate], ["g9", awaitsThenAwaits]] as const)
        await consume(label, make());
    note("--- several requests at once");
    for (const make of [awaits, catchesAwait, yields, catchesYield, returns, catchesReturn, awaitsThenAwaits]) {
        const generator = make();
        await Promise.all([watch("first", generator.next()), watch("second", generator.next()), watch("third", generator.next()), watch("fourth", generator.next())]);
    }
    note("--- return() and throw() with a broken promise");
    const unstarted = plain();
    await watch("return on one not started", unstarted.return(broken("r1")));
    await watch("next behind it", unstarted.next());
    const started = plain();
    await watch("next", started.next());
    await watch("return on one that is suspended", started.return(broken("r2")));
    await watch("next behind it", started.next());
    const ended = plain();
    for await (const value of ended)
        note("ended sees " + value);
    await Promise.all([watch("return on one that has ended", ended.return(broken("r3"))), watch("next in the same turn", ended.next()), watch("return again", ended.return(broken("r4")))]);
    const thrown = plain();
    await watch("next", thrown.next());
    await watch("throw", thrown.throw(broken("t1")));
    console.log(log.join("\n"));
}

main();
