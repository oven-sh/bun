// Objects that async generators yield and async functions return: plain records, class instances, arrays, functions, maps, objects
// without a prototype; and the same kinds with a `then`: as an own method, an own value that is no function, a getter, on the class,
// on the prototype of a plain object, added after objects of the same kind have gone through, taken away again.
// Beside every run a ticker notes the turns of the job queue, so one job more or less shows.
let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
function show(value: unknown): string {
    if (typeof value === "function") return "function " + value.name;
    if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
    if (value instanceof Map) return "Map(" + value.size + ")";
    if (typeof value === "object" && value !== null) return (Object.getPrototypeOf(value) === null ? "null-prototype" : value.constructor?.name) + JSON.stringify(value);
    return typeof value + " " + String(value);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}

interface Point { x: number; y: number; }
interface Reply { text: string; then?: (resolve: (value: string) => void) => void; }
class Plain { constructor(public n: number) {} }
class WithThen {
    constructor(public n: number) {}
    then(resolve: (value: string) => void): void { note("WithThen.then " + this.n); resolve("from the class " + this.n); }
}
class Heir extends WithThen {}
const prototypeWithThen = { then(resolve: (value: string) => void): void { note("inherited then"); resolve("from the prototype"); } };
function named(): number { return 1; }

type Maker = () => unknown;
const makers: [string, Maker][] = [
    ["a record", () => ({ x: 1, y: 2 } as Point)],
    ["a reply without then", () => ({ text: "bare" } as Reply)],
    ["a reply with then", () => ({ text: "own", then(resolve) { note("Reply.then"); resolve("from the reply"); } } as Reply)],
    ["a reply with then undefined", () => ({ text: "undefined", then: undefined } as Reply)],
    ["an instance", () => new Plain(3)],
    ["an instance of a class with then", () => new WithThen(4)],
    ["an heir of it", () => new Heir(5)],
    ["an array", () => [1, 2, 3]],
    ["an array with then", () => Object.assign([1], { then(resolve: (value: string) => void) { note("array.then"); resolve("from the array"); } })],
    ["a function", () => named],
    ["a map", () => new Map([[1, 2]])],
    ["no prototype", () => Object.assign(Object.create(null), { k: 1 })],
    ["no prototype, with then", () => Object.assign(Object.create(null), { then(resolve: (value: string) => void) { note("bare.then"); resolve("from the bare object"); } })],
    ["then is a number", () => ({ then: 5 })],
    ["then is a getter", () => Object.defineProperty({ g: 1 }, "then", { get() { note("then is read"); return undefined; }, enumerable: false })],
    ["then is inherited", () => Object.create(prototypeWithThen)],
    ["then throws", () => ({ then() { note("then throws"); throw new Error("thrown by then"); } })],
    ["a proxy", () => new Proxy({ p: 1 }, { get(target, key, receiver) { if (key === "then") note("the proxy is asked for then"); return Reflect.get(target, key, receiver); } })],
    ["a fulfilled promise", () => Promise.resolve("fulfilled")],
    ["a record once more", () => ({ x: 3, y: 4 } as Point)],
];

async function* yieldsOnce(make: Maker): AsyncGenerator<unknown> {
    note("yields");
    yield make();
    note("behind the yield");
}
async function* yieldsBehindAwait(make: Maker): AsyncGenerator<unknown> {
    await outside();
    note("yields");
    yield make();
    note("behind the yield");
    yield make();
}
async function returnsAtOnce(make: Maker): Promise<unknown> {
    return make();
}
async function returnsBehindSettled(make: Maker): Promise<unknown> {
    await undefined;
    note("returns");
    return make();
}
async function returnsBehindAwait(make: Maker): Promise<unknown> {
    await outside();
    note("returns");
    return make();
}
async function consume(source: AsyncGenerator<unknown>): Promise<void> {
    try {
        for await (const value of source) note("got " + show(value));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function take(promise: Promise<unknown>): Promise<void> {
    try {
        note("got " + show(await promise));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function resumedFirst(run: () => Promise<void>): Promise<void> {
    await outside();
    await run();
}

const ways: [string, (make: Maker) => Promise<void>][] = [
    ["yielded", make => consume(yieldsOnce(make))],
    ["yielded behind an await", make => consume(yieldsBehindAwait(make))],
    ["returned at once", make => take(returnsAtOnce(make))],
    ["returned behind a settled await", make => take(returnsBehindSettled(make))],
    ["returned behind an await", make => take(returnsBehindAwait(make))],
    ["returned, nobody waits yet", async make => { const promise = returnsBehindAwait(make); await outside(); await outside(); await outside(); await take(promise); }],
    ["returned to then", make => new Promise(resolve => { returnsBehindAwait(make).then(value => { note("then got " + show(value)); resolve(); }, error => { note("then caught " + error.message); resolve(); }); })],
    ["returned to two", async make => { const promise = returnsBehindAwait(make); await Promise.all([take(promise), take(promise)]); }],
];

const lines: string[] = [];
async function scene(title: string, run: () => Promise<void>): Promise<void> {
    log = [];
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [way, go] of ways) {
    for (const [kind, make] of makers) {
        await scene(way + ", " + kind + ", alone", () => go(make));
        await scene(way + ", " + kind + ", resumed", () => resumedFirst(() => go(make)));
        await scene(way + ", " + kind + ", beside jobs", async () => { await Promise.all([ticker("t", 9), go(make)]); });
        await scene(way + ", " + kind + ", resumed beside jobs", async () => { await Promise.all([resumedFirst(() => go(make)), ticker("t", 12)]); });
    }
}

// What has gone through many times without a `then` gets one: by its prototype, a plain object.
interface Late { n: number; }
const lateParent: { then?: (this: Late, resolve: (value: string) => void) => void } = {};
function late(n: number): Late {
    return Object.assign(Object.create(lateParent), { n });
}
async function* manyLate(n: number): AsyncGenerator<unknown> {
    for (let i = 0; i < n; i++) yield late(i);
}
async function lateBehindAwait(i: number): Promise<unknown> {
    await outside();
    return late(i);
}
await scene("a prototype gets then late", async () => {
    let sum = 0;
    for await (const one of manyLate(50)) sum += (one as Late).n;
    for (let i = 0; i < 50; i++) sum += ((await lateBehindAwait(i)) as Late).n;
    note("sum " + sum);
    lateParent.then = function (resolve) { note("late then " + this.n); resolve("late " + this.n); };
    for await (const one of manyLate(2)) note("got " + show(one));
    note("got " + show(await lateBehindAwait(7)));
    delete lateParent.then;
    for await (const one of manyLate(2)) note("got " + show(one));
    note("got " + show(await lateBehindAwait(8)));
});
await scene("one object of a kind gets then", async () => {
    const points: Point[] = [];
    for (let i = 0; i < 20; i++) points.push({ x: i, y: -i });
    (points[13] as any).then = (resolve: (value: string) => void) => { note("the thirteenth's then"); resolve("thirteen"); };
    async function* all(): AsyncGenerator<unknown> { for (const point of points) yield point; }
    async function one(i: number): Promise<unknown> { await outside(); return points[i]; }
    for await (const point of all()) note(show(point));
    for (let i = 11; i < 15; i++) note(show(await one(i)));
    delete (points[13] as any).then;
    note(show(await one(13)));
});
console.log(lines.join("\n"));
