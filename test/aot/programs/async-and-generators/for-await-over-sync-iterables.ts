// `for await` over sync iterables of every kind, alone and beside other jobs: the order of everything that happens.
let seed = 4242;
function random(below: number): number {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return Math.floor(seed / 65536) % below;
}

let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class Thenable implements PromiseLike<number> {
    constructor(private label: string, private value: number) {}
    then<A = number, B = never>(onFulfilled?: ((value: number) => A | PromiseLike<A>) | null): PromiseLike<A | B> {
        note(this.label + " then is called");
        onFulfilled?.(this.value);
        return new Promise<A | B>(() => {});
    }
}

let release: (() => void)[] = [];
function later(value: number): Promise<number> {
    return new Promise(resolve => { release.push(() => resolve(value)); });
}

type Item = number | Promise<number> | Thenable;

function* generated(label: string, kind: number, count: number): Generator<Item, string, unknown> {
    try {
        for (let i = 0; i < count; i++) {
            note(label + " makes " + i);
            switch ((kind + i) % 7) {
            case 0:
                yield i;
                break;
            case 1:
                yield Promise.resolve(i);
                break;
            case 2:
                Promise.resolve().then(() => note(label + " job queued while making " + i));
                yield i;
                break;
            case 3:
                yield later(i);
                break;
            case 4:
                yield new Thenable(label, i);
                break;
            case 5:
                if (kind === 5)
                    yield Promise.reject(new Error(label + " rejects " + i));
                else
                    yield i;
                break;
            default:
                if (kind === 6)
                    throw new Error(label + " throws at " + i);
                yield i;
            }
        }
        return "returned";
    } finally {
        note(label + " is closed");
    }
}

class Counter implements Iterable<Item> {
    constructor(private label: string, private count: number) {}
    [Symbol.iterator](): Iterator<Item> {
        note(this.label + " is asked for its iterator");
        let i = 0;
        const label = this.label;
        const count = this.count;
        return {
            next(): IteratorResult<Item> {
                note(label + " next " + i);
                return i < count ? { done: false, value: i++ } : { done: true, value: undefined };
            },
            return(): IteratorResult<Item> {
                note(label + " return");
                return { done: true, value: undefined };
            },
        };
    }
}

function iterableOf(label: string, kind: number, count: number): Iterable<Item> {
    switch (kind) {
    case 7:
        return new Counter(label, count);
    case 8:
        return new Set([1, 2, 3].slice(0, count));
    case 9:
        return new Map([[1, 1], [2, 2]]).keys();
    case 10:
        return [1, Promise.resolve(2), 3, later(4)].slice(0, count);
    case 11:
        return [5, 6, 7].slice(0, count).values();
    default:
        return generated(label, kind, count);
    }
}

async function inFunction(label: string, kind: number, count: number, leavesAt: number, startsLate: boolean): Promise<void> {
    if (startsLate)
        await null;
    let seen = 0;
    try {
        for await (const value of iterableOf(label, kind, count)) {
            note(label + " sees " + value);
            if (seen++ === leavesAt) {
                note(label + " breaks");
                break;
            }
        }
        note(label + " ends");
    } catch (error) {
        note(label + " caught " + messageOf(error));
    }
}

async function* inGenerator(label: string, kind: number, count: number): AsyncGenerator<number> {
    try {
        for await (const value of iterableOf(label, kind, count)) {
            note(label + " passes on " + value);
            yield value;
        }
    } catch (error) {
        note(label + " caught " + messageOf(error));
    }
}

async function throughGenerator(label: string, kind: number, count: number): Promise<void> {
    await null;
    for await (const value of inGenerator(label, kind, count))
        note(label + " gets " + value);
    note(label + " ends");
}

async function ticker(label: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await null;
        note(label + " " + i);
    }
}

function sumOf(lines: string[]): number {
    let sum = 7;
    for (const line of lines) {
        for (let i = 0; i < line.length; i++)
            sum = (sum * 31 + line.charCodeAt(i)) % 1000000007;
    }
    return sum;
}

function pump(done: () => boolean, finish: () => void): void {
    const waiting = release;
    release = [];
    for (const resolve of waiting)
        resolve();
    if (done())
        finish();
    else
        setTimeout(() => pump(done, finish), 0);
}

async function round(number: number, prints: boolean): Promise<void> {
    log = [];
    const work: Promise<void>[] = [];
    const loops = 1 + random(3);
    for (let i = 0; i < loops; i++) {
        const label = "l" + i;
        const kind = random(12);
        const count = random(5);
        if (random(3))
            work.push(inFunction(label, kind, count, random(4) ? -1 : random(3), !!random(2)));
        else
            work.push(throughGenerator(label, kind, count));
    }
    if (!random(3))
        work.push(ticker("t", 1 + random(8)));
    let finished = false;
    Promise.all(work).then(() => { finished = true; });
    await new Promise<void>(resolve => pump(() => finished, resolve));
    console.log(number, log.length, sumOf(log));
    if (prints)
        console.log(log.join("\n"));
}

async function main(): Promise<void> {
    for (let i = 0; i < 300; i++)
        await round(i, i % 100 === 7);
}

main();
