// yield* and for await in async generators over async generators: values, what is sent, thrown and returned, early exits, and the order of the jobs.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const log = [];
const note = (text) => log.push(text);

async function ticks(name, turns) {
    for (let turn = 0; turn < turns; turn++) {
        note(name + " " + turn);
        await undefined;
    }
}

async function* leaf(name, limit) {
    try {
        for (let number = 0; number < limit; number++) {
            const sent = yield name + number;
            if (sent !== undefined)
                note(name + " was sent " + sent);
        }
        return name + " returned";
    } finally {
        note(name + " cleans up");
    }
}

async function* delegates(name, limit) {
    note(name + " starts");
    const returned = yield* leaf(name + ".", limit);
    note(name + " sees " + returned);
    return name + " returned";
}

async function* twice(name) {
    const returned = yield* delegates(name + "/", 2);
    note(name + " sees " + returned);
    yield* [name + " list", Promise.resolve(name + " promise in a list")];
    yield* (function* () { yield name + " sync generator"; return "dropped"; })();
}

async function* forwards(source) {
    for await (const value of source)
        yield "<" + value + ">";
}

async function consume(name, iterable) {
    for await (const value of iterable)
        note(name + " got " + value);
    note(name + " is through");
}

async function main() {
    await Promise.all([consume("a", delegates("one", 3)), ticks("t", 14)]);
    note("--");
    await Promise.all([consume("b", twice("two")), ticks("u", 24)]);
    note("--");
    await Promise.all([consume("c", forwards(forwards(leaf("three", 3)))), ticks("v", 20)]);
    note("--");

    const stepped = delegates("four", 4);
    note(JSON.stringify(await stepped.next("dropped")));
    note(JSON.stringify(await stepped.next("x")));
    note(JSON.stringify(await stepped.return("left")));
    note(JSON.stringify(await stepped.next("y")));
    const thrown = delegates("five", 4);
    await thrown.next();
    try {
        await thrown.throw(new RangeError("thrown in"));
    } catch (error) {
        note("caught " + error.message);
    }
    note(JSON.stringify(await thrown.next()));
    note("--");

    for await (const value of twice("six")) {
        note("leaves at " + value);
        break;
    }
    note("--");

    const own = {
        turns: 0,
        [Symbol.asyncIterator]() { return this; },
        next() { return Promise.resolve({ done: ++this.turns > 2, value: "own " + this.turns }); },
        return() { note("own return"); return Promise.resolve({}); },
    };
    await consume("d", own);
    await consume("e", { [Symbol.asyncIterator]: () => leaf("seven", 2) });
    await consume("f", (async function* () { yield* own; yield* { [Symbol.asyncIterator]: () => leaf("eight", 1) }; })());
    class Stream {
        async *[Symbol.asyncIterator]() { yield "from a method"; }
    }
    await consume("g", new Stream());
    note("--");

    async function* returnsPromise() { return Promise.resolve("settled"); }
    note(JSON.stringify(await returnsPromise().next()));
    async function* seesReturned() { note("sees " + (await (yield* returnsPromise()))); }
    await consume("h", seesReturned());
}

await main();
for (const line of log)
    report(line);
report("end");
