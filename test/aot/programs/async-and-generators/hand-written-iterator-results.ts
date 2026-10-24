// `for await` and `yield*` over async iterators written by hand: what next() hands back is of every make: literals with the two properties in either order,
// with more properties, with getters that note when they are read, inherited properties, class instances, frozen objects, proxies, one object used again and
// again, the engine's own result objects taken from another iterator; `done` of every kind of value; steps that lack a property; steps that are no objects.
const lines: string[] = [];
let log: string[] = [];
type Step = unknown;
function iterable(steps: (() => Step)[]): AsyncIterable<unknown> {
    let i = 0;
    return { [Symbol.asyncIterator]() { return { next() { return Promise.resolve(i < steps.length ? steps[i++]() : { done: true, value: "the end" }); } } as AsyncIterator<unknown>; } };
}
class Made { constructor(public value: unknown, public done: unknown) {} }
class MadeTheOtherWay { constructor(public done: unknown, public value: unknown) {} }
const reused: { value: unknown; done: boolean } = { value: 0, done: false };
function* engine(): Generator<string> { yield "from a generator"; }
const array = ["from an array"];
const kinds: [string, (() => Step)[]][] = [
    ["value first", [() => ({ value: 1, done: false })]],
    ["done first", [() => ({ done: false, value: 2 })]],
    ["more properties", [() => ({ extra: 0, value: 3, done: false, more: 1 })]],
    ["getters", [() => ({ get done() { log.push("done is read"); return false; }, get value() { log.push("value is read"); return 4; } })]],
    ["getters at the end", [() => ({ get done() { log.push("done is read"); return true; }, get value() { log.push("value is read"); return 5; } })]],
    ["inherited", [() => Object.create({ value: 6, done: false })]],
    ["half inherited", [() => Object.assign(Object.create({ done: false }), { value: 7 })]],
    ["a class instance", [() => new Made(8, false), () => new MadeTheOtherWay(false, 9)]],
    ["frozen", [() => Object.freeze({ value: 10, done: false })]],
    ["a proxy", [() => new Proxy({ value: 11, done: false }, { get(target, key, receiver) { log.push("asked for " + String(key)); return Reflect.get(target, key, receiver); } })]],
    ["one object again and again", [() => { reused.value = 12; return reused; }, () => { reused.value = 13; return reused; }, () => { reused.done = true; return reused; }]],
    ["the engine's own", [() => engine().next(), () => array[Symbol.iterator]().next(), () => new Map([[1, 2]]).entries().next()]],
    ["the engine's own, changed", [() => Object.assign(engine().next(), { value: "changed" }), () => { const step = engine().next(); delete (step as any).done; return step; }, () => Object.defineProperty(engine().next(), "value", { get() { log.push("a getter on the engine's own"); return 14; } })]],
    ["done is zero", [() => ({ value: 15, done: 0 })]],
    ["done is one", [() => ({ value: 16, done: 1 })]],
    ["done is a text", [() => ({ value: 17, done: "" }), () => ({ value: 18, done: "yes" })]],
    ["done is an object", [() => ({ value: 19, done: {} })]],
    ["done is null, undefined, NaN", [() => ({ value: 20, done: null }), () => ({ value: 21, done: undefined }), () => ({ value: 22, done: NaN })]],
    ["no done", [() => ({ value: 23 })]],
    ["no value", [() => ({ done: false })]],
    ["empty", [() => ({})]],
    ["a function", [() => Object.assign(() => 0, { value: 24, done: false })]],
    ["an array", [() => Object.assign([], { value: 25, done: false })]],
    ["a number", [() => 26]],
    ["undefined", [() => undefined]],
    ["a text", [() => "step"]],
    ["null", [() => null]],
];
async function byLoop(source: AsyncIterable<unknown>): Promise<void> {
    try {
        for await (const x of source) log.push("got " + JSON.stringify(x));
        log.push("over");
    } catch (error) {
        log.push("caught " + (error as Error).constructor.name);
    }
}
async function* delegating(source: AsyncIterable<unknown>): AsyncGenerator<unknown, string> {
    const returned = yield* source as AsyncIterable<unknown, unknown>;
    return "returned " + JSON.stringify(returned);
}
async function byDelegation(source: AsyncIterable<unknown>): Promise<void> {
    const outer = delegating(source);
    try {
        for (;;) {
            const step = await outer.next();
            log.push((step.done ? "done " : "got ") + JSON.stringify(step.value));
            if (step.done) break;
        }
    } catch (error) {
        log.push("caught " + (error as Error).constructor.name);
    }
}
async function* throughGenerator(source: AsyncIterable<unknown>): AsyncGenerator<unknown> {
    for await (const x of source) yield x;
}
for (const [title, steps] of kinds) {
    for (const [way, run] of [["loop", byLoop], ["yield*", byDelegation], ["loop in a generator", (source: AsyncIterable<unknown>) => byLoop(throughGenerator(source))]] as const) {
        log = []; reused.done = false;
        await run(iterable(steps));
        lines.push(title + ", " + way + ": " + log.join(" | "));
    }
}
console.log(lines.join("\n"));
