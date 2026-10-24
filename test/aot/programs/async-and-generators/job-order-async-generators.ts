// The order in which things happen when async generators, `for await` and async functions run side by side.
// Each round builds a few chains from a seed. A chain awaits plain values, settled promises, promises that another chain settles later,
// thenables and calls of async functions. Everything that happens is written to one log, and the log is reduced to a checksum per round.
let log: string[] = [];
function note(text: string): void {
    log.push(text);
}

let seed = 1;
function random(limit: number): number {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return Math.floor(seed / 65536) % limit;
}

let gates: ((value: number) => void)[] = [];
function gate(): Promise<number> {
    return new Promise<number>(resolve => {
        gates.push(resolve);
    });
}
function openGate(label: string): void {
    const resolve = gates.shift();
    if (resolve) {
        note(label + " opens a gate");
        resolve(gates.length);
    }
}

async function plain(value: number): Promise<number> {
    return value + 1;
}
async function slow(value: number): Promise<number> {
    await null;
    await undefined;
    return value + 2;
}
class Thenable {
    constructor(private label: string, private value: number) {}
    then(onFulfilled: (value: number) => void): void {
        note(this.label + " then is called");
        onFulfilled(this.value + 3);
    }
}
function thenable(label: string, value: number): Thenable {
    return new Thenable(label, value);
}

async function something(label: string, kind: number, value: number): Promise<number> {
    switch (kind) {
    case 0:
        return (await value) + 1;
    case 1:
        return await Promise.resolve(value);
    case 2:
        return await plain(value);
    case 3:
        return await slow(value);
    case 4:
        return await thenable(label, value);
    case 5:
        openGate(label);
        return value;
    case 6:
        try {
            return await Promise.reject(new Error("no " + value));
        } catch (error) {
            note(label + " caught " + String(error));
            return value;
        }
    default:
        return await gate();
    }
}

async function* source(label: string, count: number, kinds: number[]): AsyncGenerator<number, string, unknown> {
    note(label + " starts");
    try {
        for (let i = 0; i < count; i++) {
            const kind = kinds[i % kinds.length];
            let value = i;
            switch (kind) {
            case 0:
                value = (await i) + 1;
                break;
            case 1:
                value = await Promise.resolve(i);
                break;
            case 2:
                value = await plain(i);
                break;
            case 3:
                value = await slow(i);
                break;
            case 4:
                value = await thenable(label, i);
                break;
            case 5:
                openGate(label);
                break;
            case 6:
                value = await something(label, random(8), i);
                break;
            case 7:
                value = await gate();
                break;
            default:
                break;
            }
            note(label + " yields " + value);
            const sent = yield kind === 8 ? Promise.resolve(value) : value;
            if (sent !== undefined)
                note(label + " was sent " + String(sent));
        }
        return label + " is over";
    } finally {
        note(label + " leaves");
        if (count % 2)
            await null;
        note(label + " has left");
    }
}

async function* mapped(label: string, inner: AsyncGenerator<number, string, unknown>, awaitsToo: boolean): AsyncGenerator<number, string, unknown> {
    for await (const value of inner) {
        note(label + " takes " + value);
        if (awaitsToo)
            await null;
        yield value * 10;
    }
    return label + " is over";
}

async function* delegating(label: string, inner: AsyncGenerator<number, string, unknown>): AsyncGenerator<number, string, unknown> {
    const result = yield* inner;
    note(label + " got " + result);
    return label + " is over";
}

async function* overSync(label: string, values: (number | Promise<number>)[]): AsyncGenerator<number, void, unknown> {
    for await (const value of values) {
        note(label + " takes " + value);
        yield value;
    }
}

async function consume(label: string, chain: AsyncGenerator<number, unknown, unknown>, leavesAt: number): Promise<void> {
    let seen = 0;
    for await (const value of chain) {
        note(label + " sees " + value);
        if (++seen === leavesAt) {
            note(label + " breaks");
            break;
        }
    }
    note(label + " is done");
}

async function consumeByHand(label: string, chain: AsyncGenerator<number, unknown, unknown>, atOnce: number): Promise<void> {
    for (let round = 0; round < 4; round++) {
        const steps: Promise<IteratorResult<number, unknown>>[] = [];
        for (let i = 0; i < atOnce; i++)
            steps.push(chain.next(round * 10 + i));
        if (round === 2)
            steps.push(chain.return("closed by " + label));
        for (const step of steps) {
            const result = await step;
            note(label + " got " + String(result.value) + " " + result.done);
        }
    }
    note(label + " is done");
}

async function ticker(label: string, ticks: number): Promise<void> {
    for (let i = 0; i < ticks; i++) {
        await null;
        note(label + " " + i);
    }
}

function build(label: string, depth: number): AsyncGenerator<number, unknown, unknown> {
    const kinds: number[] = [];
    for (let i = 1 + random(4); i > 0; i--)
        kinds.push(random(10));
    let chain: AsyncGenerator<number, string, unknown> = source(label + ".0", 1 + random(6), kinds);
    for (let level = 1; level <= depth; level++)
        chain = random(3) ? mapped(label + "." + level, chain, random(2) === 0) : delegating(label + "." + level, chain);
    return chain;
}

function checksum(lines: string[]): number {
    let sum = 0;
    for (const line of lines) {
        for (let i = 0; i < line.length; i++)
            sum = (sum * 31 + line.charCodeAt(i)) % 1000000007;
        sum = (sum * 31 + 10) % 1000000007;
    }
    return sum;
}

async function round(number: number): Promise<void> {
    seed = number * 7919 + 1;
    log = [];
    gates = [];
    const running: Promise<void>[] = [];
    const chains = 1 + random(3);
    for (let i = 0; i < chains; i++) {
        const label = "c" + i;
        const chain = random(5) ? build(label, random(4)) : overSync(label, [1, Promise.resolve(2), 3, plain(3)]);
        running.push(random(4) ? consume(label, chain, random(3) ? 0 : 1 + random(4)) : consumeByHand(label, chain, 1 + random(3)));
    }
    if (random(3) === 0)
        running.push(ticker("tick", 3 + random(12)));
    let settled = false;
    const all = Promise.all(running).then(() => {
        settled = true;
    });
    for (let turn = 0; turn < 60 && !settled; turn++) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!settled)
            openGate("the round");
    }
    await (settled ? all : undefined);
    console.log(number, settled, log.length, checksum(log));
    if (number % 25 === 0)
        console.log(log.slice(0, 40).join(" | "));
}

async function main(): Promise<void> {
    for (let number = 1; number <= 150; number++)
        await round(number);
}

main();
