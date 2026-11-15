// answers: with-library
// # for await asks the function that the open has read whether it is the next of the engine, and the iterator whether it is an async generator.
// # At the end the shell runs the same text itself: every answer is the same.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
const log = [];
const note = (text) => log.push(text);

async function* count(limit) {
    for (let number = 0; number < limit; number++)
        yield number;
}
async function collect(name, iterable) {
    const seen = [];
    try {
        for await (const value of iterable)
            seen.push(String(value));
    } catch (error) {
        seen.push(error.name);
    }
    note(name + ": " + seen.join(", "));
}
async function ticks(name, turns) {
    for (let turn = 0; turn < turns; turn++) {
        note(name + " " + turn);
        await undefined;
    }
}
const enginesNext = count(0).next;

async function main() {
    await collect("borrowed", { [Symbol.asyncIterator]() { return this; }, next: enginesNext });
    await collect("below a generator", { [Symbol.asyncIterator]() { return Object.create(count(2)); } });
    await collect("proxy", { [Symbol.asyncIterator]() { return new Proxy(count(2), {}); } });
    await collect("sync generator", { [Symbol.asyncIterator]() { return (function* () { yield 1; })(); } });

    const ownNext = count(3);
    let calls = 0;
    ownNext.next = function () { return Promise.resolve(++calls > 2 ? { done: true } : { done: false, value: "own " + calls }); };
    await collect("own next", ownNext);

    async function* replaced() { yield "never seen"; }
    replaced.prototype.next = function () { return { done: true }; };
    await collect("next on the prototype", replaced());

    async function* wrapped() { yield 1; yield 2; }
    wrapped.prototype.next = async function (value) {
        const result = await enginesNext.call(this, value);
        return result.done ? result : { done: false, value: result.value * 100 };
    };
    await collect("wrapped", wrapped());

    const changedInLoop = count(4);
    const seen = [];
    for await (const value of changedInLoop) {
        seen.push(value);
        changedInLoop.next = () => ({ done: true });
    }
    note("changed in the loop: " + seen.join());

    const otherIterator = count(3);
    otherIterator[Symbol.asyncIterator] = function () { return count(1); };
    await collect("another @@asyncIterator", otherIterator);

    const ownReturn = count(3);
    ownReturn.return = function () { note("own return"); return {}; };
    for await (const value of ownReturn)
        break;
    await collect("behind its own return", ownReturn);

    const reparented = count(3);
    Object.setPrototypeOf(reparented, { next() { return { done: true }; }, [Symbol.asyncIterator]() { return this; } });
    await collect("another prototype", reparented);
    const orphan = count(3);
    Object.setPrototypeOf(orphan, null);
    await collect("no prototype", orphan);

    await collect("a result that is no object", { [Symbol.asyncIterator]() { return this; }, next() { return 1; } });
    await collect("a next that returns no promise", { turns: 0, [Symbol.asyncIterator]() { return this; }, next() { return { done: ++this.turns > 1, value: "plain" }; } });

    const foreign = loadString("(async function* () { yield 'from'; yield 'elsewhere'; })");
    await collect("another realm", foreign());
}

await main();
for (const line of log)
    report(line);
report("end");
