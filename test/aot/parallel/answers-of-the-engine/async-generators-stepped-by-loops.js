// for await steps an async generator without a promise and without an object for each step, and each step ends in the turn of the job queue in which it ends by the protocol.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const log = [];
const note = (text) => log.push(text);
const tick = async () => { for (let turn = 0; turn < 7; turn++) await undefined; };

async function* count(name, limit) {
    for (let number = 0; number < limit; number++) {
        note(name + " yields " + number);
        yield number;
    }
    note(name + " returns");
    return name + " returned";
}

async function consume(name, iterable) {
    for await (const value of iterable)
        note(name + " got " + value);
    note(name + " is through");
}

async function ticks(name, turns) {
    for (let turn = 0; turn < turns; turn++) {
        note(name + " " + turn);
        await undefined;
    }
}

async function* awaits(name) {
    note(name + " starts");
    await undefined;
    yield "behind an await";
    await tick();
    yield "behind a timer";
    yield Promise.resolve("a promise that is yielded");
    yield { then(resolve) { note(name + " then is called"); resolve("a thenable that is yielded"); } };
}

async function* fails(name) {
    yield 1;
    throw new RangeError(name + " fails");
}

async function* yieldsRejection() {
    try {
        yield Promise.reject(new TypeError("rejected and yielded"));
    } catch (error) {
        note("the body catches " + error.message);
        yield "goes on";
    }
}

async function* guarded(name) {
    try {
        yield "first";
        yield "second";
    } finally {
        note(name + " cleans up");
        await undefined;
        note(name + " has cleaned up");
    }
}

async function main() {
    await Promise.all([consume("a", count("one", 3)), ticks("t", 12)]);
    note("--");
    await Promise.all([consume("b", count("two", 2)), consume("c", count("three", 2)), ticks("u", 10)]);
    note("--");
    await Promise.all([consume("d", awaits("four")), ticks("v", 8)]);
    note("--");
    try {
        await consume("e", fails("five"));
    } catch (error) {
        note("caught " + error.message);
    }
    await consume("f", yieldsRejection());
    note("--");

    for await (const value of guarded("six")) {
        note("leaves at " + value);
        break;
    }
    note("behind the loop");
    try {
        for await (const value of guarded("seven")) {
            note("throws at " + value);
            throw new Error("out of the loop");
        }
    } catch (error) {
        note("caught " + error.message);
    }
    const left = await (async () => {
        for await (const value of guarded("eight"))
            return "returned at " + value;
    })();
    note(left);
    note("--");

    const ended = count("nine", 1);
    await consume("g", ended);
    await consume("h", ended);
    const begun = count("ten", 3);
    note(JSON.stringify(await begun.next()));
    await consume("i", begun);
    const shared = count("eleven", 6);
    const early = [shared.next(), shared.next()];
    const loop = consume("j", shared);
    const late = shared.next();
    note(JSON.stringify(await Promise.all(early)));
    note(JSON.stringify(await late));
    await loop;
    note("--");

    const both = count("twelve", 5);
    await Promise.all([consume("k", both), consume("l", both)]);
    note("--");

    await Promise.all([consume("m", [1, Promise.resolve(2), 3]), ticks("w", 8)]);
    await consume("n", (function* () { yield "sync"; yield Promise.resolve("sync promise"); })());
    await consume("o", new Set(["member"]));
    await consume("p", "ab");
    try {
        await consume("q", [Promise.reject(new Error("rejected in a list"))]);
    } catch (error) {
        note("caught " + error.message);
    }
}

await main();
for (const line of log)
    report(line);
report("end");
