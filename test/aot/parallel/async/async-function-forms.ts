const collect = (): void => Bun.gc(true);
const lines: string[] = [];
function say(...values: unknown[]): void { lines.push(values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); }
function later<T>(value: T, turns = 1): Promise<T> {
    let promise: Promise<T> = Promise.resolve(value);
    for (let i = 1; i < turns; i++)
        promise = promise.then(same => same);
    return promise;
}
function failing(message: string, turns = 1): Promise<never> { return later(0, turns).then(() => { throw new Error(message); }); }
interface Point { x: number; y: number }
class Counter {
    private count = 0;
    constructor(readonly name: string) { }
    async bump(by: number): Promise<number> { this.count += await later(by); return this.count; }
    async twice(by: number): Promise<string> { const first = await this.bump(by); const second = await this.bump(by); return this.name + ":" + first + ":" + second; }
    static async make(name: string): Promise<Counter> { await null; return new Counter(name); }
}
async function noAwait(x: number): Promise<number> { return x + 1; }
async function throwsAtOnce(): Promise<number> { throw new Error("at once"); }
async function awaitsPlainValues(): Promise<string> { const a = await 1; const b = await "two"; const c = await undefined; const d = await null; const e = await { three: 3 }; return [a, b, c, d, e.three].join(); }
async function awaitsThenable(): Promise<number> { return await ({ then(resolve: (value: number) => void) { resolve(42); } } as unknown as Promise<number>); }
async function manyKinds(text: string, whole: number, real: number, flag: boolean, point: Point, list: number[]): Promise<string> {
    let sum = whole;
    let product = real;
    const copy = { x: point.x, y: point.y };
    sum += await later(1);
    collect();
    product *= await later(1.5);
    const junk: Point[] = [];
    for (let i = 0; i < 2000; i++)
        junk.push({ x: i, y: -i });
    list.push(await later(junk.length));
    collect();
    return [text, sum, product, flag, copy.x + copy.y, point.x, list.join("+")].join("|");
}
async function inExpressions(a: number): Promise<number> { return a * (await later(2)) + (await later(3)) * a + [await later(4), await later(5)].length; }
async function asArguments(): Promise<string> { return [String(await later("p")), String(await later("q")) + (await later("r"))].join("-"); }
async function loops(n: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < n; i++) {
        if (i % 3 === 0)
            continue;
        total += await later(i, 1 + i % 2);
        if (total > 40)
            break;
    }
    let k = 0;
    while (k < 3)
        k += await later(1);
    do
        k -= await later(2);
    while (k > 0);
    return total * 10 + k;
}
async function overCollections(): Promise<string> {
    const out: string[] = [];
    for (const item of ["a", "b", "c"])
        out.push(item + (await later(item.length)));
    for (const [key, value] of new Map([["k", 1], ["l", 2]]))
        out.push(key + (await later(value)));
    for (const member of new Set([7, 8]))
        out.push(String(await later(member)));
    for (const key in { m: 1, n: 2 })
        out.push(await later(key));
    return out.join();
}
async function caught(message: string): Promise<string> {
    try {
        await failing(message);
        return "not reached";
    } catch (error) {
        return "caught " + (error as Error).message + " " + (await later("after"));
    }
}
async function withFinally(fails: boolean): Promise<string> {
    const trail: string[] = [];
    try {
        try {
            trail.push(await later("in"));
            if (fails)
                await failing("inner");
            trail.push("done");
        } finally {
            trail.push(await later("finally"));
        }
    } catch (error) {
        trail.push("outer " + (error as Error).message);
    }
    return trail.join();
}
async function returnsFromFinally(): Promise<number> { try { return await later(1); } finally { await later(2); say("the finally ran"); } }
async function rejectsLate(): Promise<number> { const x = await later(5); await later(6); throw new Error("late " + x); }
async function rejectsByCall(): Promise<number> { await later(1); const nothing: any = null; return nothing.field; }
async function passesOn(): Promise<number> { return rejectsLate(); }
async function returnAwait(): Promise<string> { try { return await failing("returned") as string; } catch (error) { return "held " + (error as Error).message; } }
async function recursive(depth: number): Promise<number> { return depth ? depth + await recursive(depth - 1) : await later(0); }
async function closures(): Promise<number> {
    let shared = 1;
    const add = (by: number): void => { shared += by; };
    const read = async (): Promise<number> => { await later(0); return shared; };
    add(await later(2));
    const before = await read();
    add(10);
    return before * 100 + (await read());
}
async function defaults(a = 1, { b, c }: { b: number; c: number } = { b: 2, c: 3 }, ...rest: number[]): Promise<number> { await later(0); return a + b + c + rest.length; }
async function* numbers(n: number): AsyncGenerator<number> { for (let i = 0; i < n; i++) yield await later(i); }
async function forAwait(): Promise<number> {
    let total = 0;
    for await (const n of numbers(4))
        total += n;
    for await (const n of [later(10), 20, later(30)])
        total += n;
    return total;
}
async function together(): Promise<string> {
    const counters = await Promise.all([Counter.make("x"), Counter.make("y"), Counter.make("z")]);
    const results = await Promise.all(counters.map((counter, i) => counter.twice(i + 1)));
    const settled = await Promise.allSettled([rejectsLate(), noAwait(1), caught("z")]);
    const first = await Promise.race([later("slow", 5), later("fast", 1)]);
    return results.join() + "|" + settled.map(one => one.status).join() + "|" + first;
}
async function manyAtOnce(): Promise<number> {
    const running: Promise<number>[] = [];
    for (let i = 0; i < 200; i++)
        running.push(loops(i % 7));
    collect();
    let total = 0;
    for (const one of running)
        total += await one;
    return total;
}
async function neverGoesOn(): Promise<void> { const held = { big: new Array(1000).fill(1) }; await new Promise(() => { }); say(held.big.length); }
async function order(): Promise<void> {
    const trail: string[] = [];
    const one = (async () => { trail.push("1a"); await null; trail.push("1b"); await null; trail.push("1c"); })();
    const two = (async () => { trail.push("2a"); await null; trail.push("2b"); await null; trail.push("2c"); })();
    Promise.resolve().then(() => trail.push("t1")).then(() => trail.push("t2")).then(() => trail.push("t3"));
    trail.push("sync");
    await one; await two;
    say("order", trail.join());
}
async function report<T>(name: string, promise: Promise<T>): Promise<void> {
    try {
        say(name, await promise);
    } catch (error) {
        say(name, "rejected", error instanceof TypeError ? "TypeError" : (error as Error).message);
    }
}
async function main(): Promise<void> {
    await report("noAwait", noAwait(1));
    await report("throwsAtOnce", throwsAtOnce());
    await report("awaitsPlainValues", awaitsPlainValues());
    await report("awaitsThenable", awaitsThenable());
    await report("manyKinds", manyKinds("t", 3, 2.5, true, { x: 1, y: 2 }, [9]));
    await report("inExpressions", inExpressions(7));
    await report("asArguments", asArguments());
    await report("loops", loops(12));
    await report("overCollections", overCollections());
    await report("caught", caught("boom"));
    await report("withFinally", withFinally(false));
    await report("withFinally fails", withFinally(true));
    await report("returnsFromFinally", returnsFromFinally());
    await report("rejectsLate", rejectsLate());
    await report("rejectsByCall", rejectsByCall());
    await report("passesOn", passesOn());
    await report("returnAwait", returnAwait());
    await report("recursive", recursive(50));
    await report("closures", closures());
    await report("defaults", defaults());
    await report("defaults given", defaults(5, { b: 6, c: 7 }, 8, 9));
    await report("forAwait", forAwait());
    await report("together", together());
    await report("manyAtOnce", manyAtOnce());
    for (let i = 0; i < 50; i++)
        neverGoesOn();
    collect();
    await order();
    collect();
    await report("manyKinds again", manyKinds("u", 4, 0.5, false, { x: 3, y: 4 }, []));
}
main().then(() => console.log(lines.join("\n")), error => console.log("main rejected", error, lines.join("\n")));
