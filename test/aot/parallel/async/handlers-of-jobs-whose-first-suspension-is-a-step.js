const report = value => console.log(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : String(value));
const log = [];
const note = (text) => log.push(text);

async function* count(name, limit) {
    for (let number = 0; number < limit; number++) {
        note(name + " yields " + number);
        yield number;
    }
    return name + " returned";
}
async function* awaitsFirst(name) {
    await undefined;
    yield name + " behind an await";
}
async function ticks(name, turns) {
    for (let turn = 0; turn < turns; turn++) {
        note(name + " " + turn);
        await undefined;
    }
}
async function consume(name, iterable) {
    for await (const value of iterable)
        note(name + " got " + value);
    note(name + " is through");
}
async function* around(name, inner) {
    const returned = yield* inner;
    note(name + " sees " + returned);
}

async function main() {
    // The handler of a job is an async function whose first suspension is a step.
    await Promise.all([Promise.resolve("a").then((name) => consume(name, count("one", 2))), ticks("t", 8)]);
    await Promise.all([Promise.resolve("b").then(async (name) => { for await (const value of count("two", 2)) note(name + " got " + value); }), ticks("u", 8)]);
    await Promise.all([Promise.resolve("c").then((name) => consume(name, awaitsFirst("three"))), ticks("v", 8)]);
    await Promise.all([Promise.resolve("d").then((name) => consume(name, around("four", count("five", 2)))), ticks("w", 10)]);
    await new Promise((resolve) => queueMicrotask(() => consume("e", count("six", 2)).then(resolve)));
    await new Promise((resolve) => setTimeout(() => consume("f", count("seven", 2)).then(resolve), 0));

    // The generator is busy, has ended, or has requests that wait, when the handler takes its first step.
    const busy = count("eight", 4);
    const first = busy.next();
    await Promise.all([Promise.resolve("g").then((name) => consume(name, busy)), first.then((result) => note("first " + JSON.stringify(result))), ticks("x", 10)]);
    const ended = count("nine", 0);
    await ended.next();
    await Promise.resolve("h").then((name) => consume(name, ended));
    const queued = count("ten", 5);
    const requests = [queued.next(), queued.next(), queued.next()];
    await Promise.all([Promise.resolve("i").then((name) => consume(name, queued)), Promise.all(requests).then((results) => note("requests " + JSON.stringify(results)))]);
}

main().then(() => {
    for (const line of log)
        report(line);
});
