const report = value => console.log(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : String(value));
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

    // next, throw and return go through the delegation.
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

    // Early exit of a loop over a delegation.
    for await (const value of twice("six")) {
        note("leaves at " + value);
        break;
    }
    note("--");

    // An async iterable of the program's own, and one that hands out a generator.
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

    // The value of a `return` in an async generator is awaited, that of a delegation's last step is not awaited again.
    async function* returnsPromise() { return Promise.resolve("settled"); }
    note(JSON.stringify(await returnsPromise().next()));
    async function* seesReturned() { note("sees " + (await (yield* returnsPromise()))); }
    await consume("h", seesReturned());
}

main().then(() => {
    for (const line of log)
        report(line);
});
