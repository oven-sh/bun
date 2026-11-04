const report = (value: any) => console.log(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : String(value));
function* count(limit: number): Generator<number, string> {
    for (let number = 0; number < limit; number++)
        yield number;
    return "returned";
}

function sum(iterable: Generator<number>) {
    let total = 0;
    for (const number of iterable)
        total += number;
    return total;
}

for (let turn = 0; turn < 3; turn++)
    report(sum(count(5 + turn)));
report(sum([1, 2, 3] as any));
report(sum(new Set([4, 5]) as any));

// A generator that has ended, one that has been stepped, one that is running.
const ended = count(2);
report(sum(ended));
report(sum(ended));
const begun = count(4);
begun.next();
report(sum(begun));

let running: Generator<number>;
function* stepsItself(): Generator<number> {
    yield 1;
    try {
        for (const value of running)
            report("never " + value);
    } catch (error: any) {
        report(error.name);
    }
    yield 2;
}
running = stepsItself();
for (const value of running)
    report(value);

// Leaving a loop early runs what `finally` holds, and in which order.
function* guarded(log: string[]): Generator<string> {
    try {
        yield "first";
        yield "second";
    } finally {
        log.push("cleaned up");
    }
}
function takeOne(iterable: Generator<string>, log: string[]) {
    for (const value of iterable) {
        log.push(value);
        break;
    }
    log.push("behind the loop");
    return log.join(", ");
}
report(takeOne(guarded([]), []));
{
    const log: string[] = [];
    report(takeOne(guarded(log), log));
}
function throwInLoop(iterable: Generator<string>, log: string[]) {
    try {
        for (const value of iterable) {
            log.push(value);
            throw new RangeError("out of the loop");
        }
    } catch (error: any) {
        log.push(error.message);
    }
    return log.join(", ");
}
{
    const log: string[] = [];
    report(throwInLoop(guarded(log), log));
}

// A body that throws: the loop does not close the generator, and the generator has ended.
function* failing() {
    yield 1;
    throw new TypeError("thrown by the body");
}
function collect(iterable: Generator<unknown>) {
    const seen: unknown[] = [];
    try {
        for (const value of iterable)
            seen.push(value);
    } catch (error: any) {
        seen.push(error.name + ": " + error.message);
    }
    return seen.join(", ");
}
const failed = failing();
report(collect(failed));
report(collect(failed));

// What is yielded: anything.
function* odd() {
    yield undefined;
    yield null;
    yield -0;
    yield NaN;
    yield { done: true, value: "looks like a result" };
    yield [1, 2];
    yield Promise;
}
for (const value of odd())
    report(typeof value === "object" && value ? JSON.stringify(value) : typeof value === "function" ? value.name : (value as any));

// The value sent by a loop is undefined, and there is an argument or none as far as the body can tell: it cannot.
function* echoes(): Generator<string, void, unknown> {
    const first = yield "ask";
    report("sent " + first);
    const second = yield "ask again";
    report("sent " + second);
}
for (const value of echoes())
    report(value);

// Generators around generators.
function* inner(): Generator<string, string, unknown> {
    const sent = yield "inner 1";
    report("inner got " + sent);
    yield "inner 2";
    return "what inner returns";
}
function* outer(): Generator<unknown, void, unknown> {
    yield "outer 1";
    const returned = yield* inner();
    report(returned);
    yield* [10, 20];
    yield* "ab";
    yield "outer 2";
}
report(collect(outer()));
const stepped = outer();
report(JSON.stringify(stepped.next("a")));
report(JSON.stringify(stepped.next("b")));
report(JSON.stringify(stepped.next("c")));
report(JSON.stringify(stepped.return("left")));
report(JSON.stringify(stepped.next("d")));

function* delegatesWithCleanup(log: string[]): Generator<string> {
    try {
        yield* guarded(log);
    } finally {
        log.push("outer cleaned up");
    }
}
{
    const log: string[] = [];
    report(takeOne(delegatesWithCleanup(log), log));
}
{
    const log: string[] = [];
    const generator = delegatesWithCleanup(log);
    generator.next();
    try {
        generator.throw(new Error("thrown in"));
    } catch (error: any) {
        log.push(error.message);
    }
    report(log.join(", "));
}

// Patterns and spreads.
const [one, two, ...rest] = count(5);
report(one + " " + two + " " + rest);
const [only] = guarded([]);
report(only);
report([...count(3), ...count(2)].join());
report(Math.max(...count(4)));
report(Array.from(count(3)).join());
report(new Set(count(3)).size);
report(Object.fromEntries((function* () { yield ["a", 1]; yield ["b", 2]; })() as any).b);
