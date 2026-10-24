// The order in which everything happens when async functions return to async functions that wait for them:
// alone (nothing else is queued), beside tickers, with several waiters on one promise, and with every kind of returned value.
import { AsyncLocalStorage } from "node:async_hooks";

let seed = 12345;
function random(below: number): number {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return Math.floor(seed / 65536) % below;
}

let log: string[] = [];
function note(text: string): void {
    log.push(text);
}

class Thenable implements PromiseLike<number> {
    constructor(private label: string, private value: number) {}
    then<A = number, B = never>(onFulfilled?: ((value: number) => A | PromiseLike<A>) | null): PromiseLike<A | B> {
        note(this.label + " then is called");
        onFulfilled?.(this.value + 5);
        return new Promise<A | B>(() => {});
    }
}

interface Box { value: number }
const storage = new AsyncLocalStorage<string>();
function where(): string {
    return storage.getStore() ?? "-";
}

let release: (() => void)[] = [];
function outside(): Promise<void> {
    return new Promise(resolve => { release.push(resolve); });
}

async function bottom(label: string, kind: number, value: number): Promise<number | Box> {
    note(label + " bottom starts in " + where());
    switch (kind) {
    case 0:
        await null;
        return value;
    case 1:
        await outside();
        return value + 1;
    case 2:
        await outside();
        return { value: value + 2 };
    case 3:
        await null;
        return Promise.resolve(value + 3);
    case 4:
        await outside();
        return new Thenable(label, value);
    case 5:
        await outside();
        throw new Error(label + " fails");
    case 6:
        return value + 6;
    case 7:
        try {
            await outside();
            return value + 7;
        } finally {
            note(label + " finally in " + where());
        }
    default:
        await outside();
        await null;
        await outside();
        return value + 8;
    }
}

function numberOf(result: number | Box): number {
    return typeof result === "number" ? result : result.value;
}

async function level(label: string, depth: number, kind: number, value: number): Promise<number> {
    if (!depth)
        return numberOf(await bottom(label, kind, value));
    let result: number;
    if ((depth + kind) % 4 === 3) {
        try {
            result = await level(label, depth - 1, kind, value);
        } catch (error) {
            note(label + " level " + depth + " caught " + String(error) + " in " + where());
            result = -depth;
        }
    } else if ((depth + kind) % 5 === 4)
        result = await storage.run(label + depth, () => level(label, depth - 1, kind, value));
    else
        result = await level(label, depth - 1, kind, value);
    note(label + " level " + depth + " has " + result + " in " + where());
    return result + 1;
}

async function ticker(label: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await null;
        note(label + " " + i);
    }
}

async function twoWaiters(label: string, kind: number): Promise<void> {
    const shared = level(label, 1, kind, 100);
    const first = (async () => { note(label + " first has " + await shared); })();
    const second = (async () => { note(label + " second has " + await shared); })();
    shared.then(value => note(label + " then has " + value), error => note(label + " then fails " + String(error)));
    await Promise.allSettled([first, second]);
}

function pump(done: () => boolean, finish: () => void): void {
    const waiting = release;
    release = [];
    const only = random(3);
    waiting.forEach((resolve, index) => {
        if (only && index % 2 === only - 1 && waiting.length > 1)
            release.push(resolve);
        else
            resolve();
    });
    if (done())
        finish();
    else
        setTimeout(() => pump(done, finish), 0);
}

function sumOf(lines: string[]): number {
    let sum = 7;
    for (const line of lines) {
        for (let i = 0; i < line.length; i++)
            sum = (sum * 31 + line.charCodeAt(i)) % 1000000007;
    }
    return sum;
}

async function round(number: number): Promise<void> {
    log = [];
    const work: Promise<unknown>[] = [];
    const chains = 1 + random(3);
    for (let i = 0; i < chains; i++) {
        const label = "c" + i;
        const depth = random(6);
        const kind = random(9);
        const started = random(4) ? level(label, depth, kind, i * 10) : storage.run("s" + i, () => level(label, depth, kind, i * 10));
        work.push(started.then(value => note(label + " ends with " + value), error => note(label + " ends failing " + String(error))));
    }
    if (!random(3))
        work.push(ticker("t", 1 + random(9)));
    if (!random(4))
        work.push(twoWaiters("w", random(9)));
    let finished = false;
    Promise.all(work).then(() => { finished = true; });
    await new Promise<void>(resolve => pump(() => finished, resolve));
    console.log(number, log.length, sumOf(log));
}

async function main(): Promise<void> {
    for (let i = 0; i < 200; i++)
        await round(i);
    log = [];
    let finished = false;
    level("alone", 5, 1, 1).then(value => {
        note("alone ends with " + value);
        finished = true;
    });
    await new Promise<void>(resolve => pump(() => finished, resolve));
    console.log(log.join("\n"));
}

main();
