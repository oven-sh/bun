const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
const tick = Promise.resolve();
const log: string[] = [];

function mix(a: number, b: number): number {
    return (a * 31 + b) % 1000003;
}

type Box = { value: number; name: string };

function box(value: number): Box {
    return { value, name: "b" + value };
}

function names(error: unknown): string {
    const frames: string[] = [];
    for (const line of ((error as Error).stack ?? "").split("\n")) {
        const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
        if (frame && frame[2] && frame[2] !== "module code" && frame[2] !== "<anonymous>")
            frames.push((frame[1] ?? "") + frame[2]);
    }
    return frames.join(" < ");
}

function* counts(seed: number): Generator<number, number, number> {
    const a = mix(seed, 1);
    const b = mix(a, 2);
    const c = box(mix(b, 3));
    let sent = yield mix(a, b);
    const d = mix(sent, c.value);
    try {
        sent = yield mix(d, a);
        const e = mix(sent, b);
        sent = yield mix(e, d);
        return mix(mix(a, b), mix(mix(c.value, d), mix(e, sent)));
    } catch (error) {
        log.push("caught in counts " + (error as Error).message + " " + mix(a, d));
        return mix(c.value, b);
    } finally {
        log.push("finally in counts " + mix(b, c.value));
    }
}

async function* streams(seed: number): AsyncGenerator<number, number, number> {
    const a = mix(seed, 4);
    const b = box(mix(a, 5));
    await tick;
    const c = mix(b.value, a);
    try {
        let sent = yield mix(a, c);
        const d = mix(sent, b.value);
        await tick;
        sent = yield mix(d, c);
        return mix(mix(a, b.value), mix(c, mix(d, sent)));
    } finally {
        await tick;
        log.push("finally in streams " + mix(a, mix(b.value, c)));
    }
}

async function thrownInto(seed: number, fails: Promise<number>): Promise<number> {
    const a = mix(seed, 6);
    const b = box(mix(a, 7));
    const c = mix(b.value, 8);
    const d = box(mix(c, a));
    try {
        const got = await fails;
        return mix(got, a);
    } catch (error) {
        collect(true);
        return mix(mix(a, b.value), mix(c, d.value)) + (error as Error).message.length;
    }
}

async function thrownThrough(seed: number, fails: Promise<number>): Promise<number> {
    const a = mix(seed, 9);
    const b = box(mix(a, 10));
    const got = await fails;
    return mix(mix(a, b.value), got);
}

async function inner(seed: number): Promise<Error> {
    const a = mix(seed, 11);
    const b = box(mix(a, 12));
    await tick;
    const c = mix(a, b.value);
    const error = new Error("made at " + c);
    log.push("inner keeps " + mix(a, mix(b.value, c)));
    return error;
}

async function outer(seed: number): Promise<string> {
    const a = mix(seed, 13);
    const b = box(mix(a, 14));
    const error = await inner(a);
    collect(true);
    return names(error) + " " + mix(a, b.value);
}

async function cellsAcrossCollections(seed: number): Promise<number> {
    const boxes: Box[] = [];
    const first = box(mix(seed, 15));
    const second = box(mix(first.value, 16));
    const third = box(mix(second.value, 17));
    const fourth = box(mix(third.value, 18));
    const fifth = box(mix(fourth.value, 19));
    const sixth = box(mix(fifth.value, 20));
    const seventh = box(mix(sixth.value, 21));
    for (let i = 0; i < 4; i++) {
        boxes.push(box(mix(i, first.value)));
        collect(true);
        await tick;
        collect(true);
        boxes.push(box(mix(i, seventh.value)));
    }
    let sum = 0;
    for (const each of [first, second, third, fourth, fifth, sixth, seventh, ...boxes])
        sum = mix(sum, each.value + each.name.length);
    return sum;
}

async function main(): Promise<void> {
    const results: (number | string)[] = [];

    const whole = counts(1);
    results.push(whole.next(0).value, whole.next(2).value, whole.next(3).value, whole.next(4).value);
    const thrown = counts(2);
    results.push(thrown.next(0).value, thrown.next(5).value, thrown.throw(new Error("from outside")).value);
    const returned = counts(3);
    results.push(returned.next(0).value, returned.next(6).value, returned.return(77).value, String(returned.next(0).done));

    const stream = streams(4);
    results.push((await stream.next(0)).value, (await stream.next(7)).value, (await stream.next(8)).value);
    const cut = streams(5);
    results.push((await cut.next(0)).value, (await cut.return(88)).value, String((await cut.next(0)).done));
    const broken = streams(6);
    results.push((await broken.next(0)).value);
    try {
        await broken.throw(new Error("into the stream"));
    } catch (error) {
        results.push((error as Error).message);
    }

    results.push(await thrownInto(7, tick.then((): number => { throw new Error("late"); })));
    results.push(await thrownInto(8, Promise.reject(new Error("at once"))));
    try {
        results.push(await thrownThrough(9, tick.then((): number => { throw new RangeError("through"); })));
    } catch (error) {
        results.push((error as Error).name);
    }
    results.push(await outer(10));
    results.push(...await Promise.all([cellsAcrossCollections(11), cellsAcrossCollections(12), outer(13)]));
    console.log(results.join("\n"));
    console.log(log.join("\n"));
}

main();
