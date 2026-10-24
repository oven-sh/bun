// A value that was converted in front of an await is wanted again behind it: what the frame keeps is the value, and the other form is made anew.
declare const console: { log(...values: unknown[]): void };

function box(value: unknown): unknown { return value; }
async function later<T>(value: T): Promise<T> { return value; }

async function numbers(n: number, ratio: number): Promise<unknown[]> {
    const before = [box(n), box(ratio), n + ratio];
    const got = await later(n * 2);
    const between = [box(n), box(ratio), n + ratio + got];
    await undefined;
    return [before, between, box(n), box(ratio), n | 0, ratio * 2];
}

async function cells(text: string, item: { id: number } | undefined): Promise<unknown[]> {
    const first = [box(text), text.length, box(item), item === undefined ? -1 : item.id];
    try {
        await later(text);
        if (item === undefined) throw text + "!";
        await later(item);
    } catch (error) {
        return [first, error, box(text), text.length, box(item)];
    }
    return [first, box(text), text.length, box(item), item.id];
}

function* steps(limit: number, step: number): Generator<unknown, string, number> {
    let total = 0.5;
    for (let i = 0; i < limit; i++) {
        const sent = yield [box(i), box(total), i + total];
        total += sent * step + i;
    }
    return "total " + total;
}

console.log(JSON.stringify(await numbers(3, 0.25)), JSON.stringify(await numbers(2 ** 32, -1.5)));
console.log(JSON.stringify(await cells("text", { id: 9 })), JSON.stringify(await cells("none", undefined)));
const walk = steps(3, 0.5);
const seen: unknown[] = [];
for (let result = walk.next(0), n = 1; ; result = walk.next(n++)) { seen.push(result.value); if (result.done) break; }
console.log(JSON.stringify(seen));
export { };
