// `yield*` and `for await` over values that went through text evaluated at run time, so the build knows nothing about them: generators of the program as they were made,
// with a `next` of their own, under another prototype, already running or finished, and arrays, strings, sets and iterators written by hand. What is sent in, thrown in and
// returned in goes to the inner iterator, and every kind of value answers as the language says.
const lines = [];
const note = (label, ...values) => lines.push(label + ": " + values.map(value => (value === undefined ? "undefined" : JSON.stringify(value))).join(" "));
const hidden = new Function("v", "return v" + String(lines.length).slice(1));

function* numbers(label) {
    try {
        const a = yield label + 1;
        const b = yield label + 2 + String(a);
        return label + "done" + String(b);
    } catch (error) {
        yield label + "caught" + error;
        return label + "after catch";
    } finally {
        note("finally", label);
    }
}
function* delegate(inner) {
    const result = yield* inner;
    note("result of yield*", result);
    return result;
}
function drain(label, inner) {
    const outer = delegate(hidden(inner));
    const seen = [];
    let sent = 0;
    for (let step = outer.next(); ; step = outer.next("s" + ++sent)) {
        seen.push(step.value);
        if (step.done) break;
    }
    note(label, ...seen);
}
drain("generator", numbers("g"));
drain("array", [1, 2]);
drain("string", "a\u{1F600}b");
drain("set", new Set(["x", "y"]));
drain("map", new Map([["k", 1]]));
drain("typed array", new Uint8Array([5, 6]));
drain("arguments", (function () { return arguments; })(8, 9));

const ownNext = numbers("own");
ownNext.next = function (value) { return { done: value === "s2", value: "own next " + value }; };
drain("own next", ownNext);

const otherPrototype = numbers("proto");
Object.setPrototypeOf(otherPrototype, {
    [Symbol.iterator]() { return this; },
    next(value) { return { done: value !== undefined, value: "other prototype " + value }; },
});
drain("other prototype", otherPrototype);

const ownIterator = numbers("iter");
ownIterator[Symbol.iterator] = function () { return [10, 20][Symbol.iterator](); };
drain("own @@iterator", ownIterator);

const started = numbers("started");
started.next();
drain("started", started);

const finished = numbers("finished");
finished.return("early");
drain("finished", finished);

function throwsIn(label, inner) {
    const outer = delegate(hidden(inner));
    try {
        note(label, outer.next().value, outer.throw("boom").value, outer.next().value, outer.next().done);
    } catch (error) {
        note(label + " threw", error instanceof TypeError ? "TypeError" : error);
    }
}
throwsIn("throw into generator", numbers("t"));
throwsIn("throw into array", [1, 2, 3]);
throwsIn("throw into hand-written", {
    [Symbol.iterator]() { return this; },
    next() { return { done: false, value: "n" }; },
    throw(error) { return { done: false, value: "handled " + error }; },
});

function returnsIn(label, inner) {
    const outer = delegate(hidden(inner));
    note(label, outer.next().value, outer.return("out"), outer.next());
}
returnsIn("return into generator", numbers("r"));
returnsIn("return into array", [1, 2, 3]);
returnsIn("return into hand-written", {
    [Symbol.iterator]() { return this; },
    next() { return { done: false, value: "n" }; },
    return(value) { return { done: false, value: "not yet " + value }; },
});

function* running() {
    try {
        yield* hidden(self);
    } catch (error) {
        note("delegating to itself", error instanceof TypeError);
    }
}
const self = running();
self.next();

for (const value of [undefined, null, 1, {}, () => {}]) {
    try {
        delegate(hidden(value)).next();
        note("no error", typeof value);
    } catch (error) {
        note("not iterable", String(value), error instanceof TypeError);
    }
}

async function* asyncNumbers(label, count) {
    try {
        for (let i = 0; i < count; i++) yield label + i;
        return label + "done";
    } finally {
        note("async finally", label);
    }
}
async function collect(label, iterable, limit = 10) {
    const seen = [];
    try {
        for await (const value of hidden(iterable)) {
            seen.push(value);
            if (seen.length === limit) break;
        }
    } catch (error) {
        seen.push(error instanceof TypeError ? "TypeError" : error);
    }
    note(label, ...seen);
}
async function* asyncDelegate(inner) {
    return yield* hidden(inner);
}
await collect("async generator", asyncNumbers("a", 3));
await collect("broken off", asyncNumbers("b", 3), 2);
await collect("sync generator", numbers("s"));
await collect("array of promises", [Promise.resolve(1), 2, Promise.resolve(3)]);
await collect("rejected element", [1, Promise.reject("no")]);
await collect("through yield*", asyncDelegate(asyncNumbers("d", 2)));
await collect("sync through yield*", asyncDelegate(["p", Promise.resolve("q")]));

const asyncOwnNext = asyncNumbers("own", 3);
asyncOwnNext.next = async function () { return { done: true }; };
await collect("async own next", asyncOwnNext);

const asyncOtherPrototype = asyncNumbers("proto", 3);
let turns = 0;
Object.setPrototypeOf(asyncOtherPrototype, {
    [Symbol.asyncIterator]() { return this; },
    next() { return Promise.resolve({ done: ++turns > 2, value: "turn " + turns }); },
});
await collect("async other prototype", asyncOtherPrototype);

const order = [];
const first = (async () => { for await (const value of hidden(asyncNumbers("x", 3))) order.push(value); })();
const second = (async () => { for await (const value of hidden(asyncNumbers("y", 3))) order.push(value); })();
let ticks = Promise.resolve();
for (let i = 0; i < 12; i++) ticks = ticks.then(() => order.push("tick" + i));
await Promise.all([first, second, ticks]);
note("two loops and a ticker", ...order);

for (const value of [undefined, null, 1, {}]) await collect("not async iterable " + String(value), value);
console.log(lines.join("\n"));
