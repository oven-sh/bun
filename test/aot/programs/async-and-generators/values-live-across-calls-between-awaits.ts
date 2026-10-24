let log: string[] = [];

function note(text: string): number {
    log.push(text);
    return log.length;
}

function mix(a: number, b: number): number {
    return (a * 31 + b) % 1000003;
}

function later<T>(value: T): Promise<T> {
    return Promise.resolve().then(() => value);
}

function fails(text: string): Promise<number> {
    return Promise.resolve().then((): number => { throw new Error(text); });
}

async function twoValues(a: number, b: number): Promise<number> {
    const first = mix(a, b);
    const second = mix(b, a);
    note("two " + first);
    const third = mix(first, second);
    const awaited = await later(third);
    note("two behind " + awaited);
    return mix(mix(first, second), mix(third, awaited));
}

async function manyValues(a: number, b: number, c: number, d: number): Promise<number> {
    const v1 = mix(a, b);
    const v2 = mix(b, c);
    const v3 = mix(c, d);
    const v4 = mix(d, a);
    const v5 = mix(v1, v2);
    const v6 = mix(v3, v4);
    const v7 = mix(v5, v6);
    const v8 = mix(v7, v1);
    note("many " + v8);
    const w1 = await later(mix(v1, v8));
    const x1 = mix(v2, w1);
    const x2 = mix(v3, x1);
    const x3 = mix(v4, x2);
    const x4 = mix(v5, x3);
    note("many between " + x4);
    const w2 = await later(mix(x4, v6));
    const y1 = mix(x1, w2);
    const y2 = mix(x2, y1);
    const y3 = mix(x3, y2);
    note("many behind " + y3);
    return mix(mix(mix(v7, v8), mix(y1, y2)), mix(y3, mix(w1, w2)));
}

async function neverWaits(a: number, b: number): Promise<number> {
    const first = mix(a, b);
    const second = mix(first, a);
    const value = await second;
    return mix(mix(first, second), mix(value, b));
}

async function inALoop(count: number, seed: number): Promise<number> {
    let sum = seed;
    const fixed = mix(seed, count);
    for (let i = 0; i < count; i++) {
        const before = mix(sum, i);
        const kept = mix(before, fixed);
        const got = i % 3 ? await later(kept) : await kept;
        sum = mix(mix(before, kept), mix(got, fixed));
    }
    return sum;
}

async function catches(a: number): Promise<number> {
    const first = mix(a, 1);
    const second = mix(a, 2);
    try {
        const third = mix(first, second);
        await fails("thrown " + third);
        return -1;
    } catch (error) {
        note((error as Error).message);
        return mix(first, second);
    } finally {
        note("finally " + mix(second, first));
    }
}

async function rejects(a: number): Promise<number> {
    const first = mix(a, 3);
    const got = await later(first);
    const second = mix(got, first);
    if (second >= 0)
        throw new Error("rejected " + second);
    return second;
}

async function awaitsOthers(a: number): Promise<number> {
    const first = mix(a, 5);
    const second = mix(first, 7);
    const r1 = await twoValues(first, second);
    const third = mix(r1, first);
    const r2 = await manyValues(first, second, third, r1);
    const fourth = mix(r2, second);
    const r3 = await neverWaits(third, fourth);
    let r4 = 0;
    try {
        r4 = await rejects(fourth);
    } catch (error) {
        r4 = note((error as Error).message);
    }
    return mix(mix(mix(first, second), mix(third, fourth)), mix(mix(r1, r2), mix(r3, r4)));
}

function callerThatKeepsValues(a: number, b: number): [number, Promise<number>[]] {
    const k1 = mix(a, b);
    const k2 = mix(k1, a);
    const k3 = mix(k2, b);
    const k4 = mix(k3, k1);
    const k5 = mix(k4, k2);
    const k6 = mix(k5, k3);
    const k7 = mix(k6, k4);
    const k8 = mix(k7, k5);
    const promises = [twoValues(k1, k2), manyValues(k3, k4, k5, k6), neverWaits(k7, k8), inALoop(7, k1), catches(k2), awaitsOthers(k3)];
    const sum = mix(mix(mix(k1, k2), mix(k3, k4)), mix(mix(k5, k6), mix(k7, k8)));
    return [sum, promises];
}

async function main(): Promise<void> {
    let total = 0;
    for (let round = 0; round < 6; round++) {
        const [sum, promises] = callerThatKeepsValues(round + 1, round * 3 + 2);
        const results = await Promise.all(promises);
        for (const result of results)
            total = mix(total, result);
        total = mix(total, sum);
    }
    const together = await Promise.all([inALoop(20, 1), inALoop(21, 2), awaitsOthers(9), awaitsOthers(10), manyValues(1, 2, 3, 4)]);
    console.log(total, together.join(","), log.length, log.slice(-6).join("|"));
}

main();
