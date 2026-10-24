// `for await` over arrays: as they are made, and in every way an array can stop iterating the way it was made.
const log: string[] = [];
function note(...parts: unknown[]): void {
    log.push(parts.map(part => String(part)).join(" "));
}

async function over(label: string, values: Iterable<unknown> | AsyncIterable<unknown>, leavesAt = -1): Promise<void> {
    let seen = 0;
    try {
        for await (const value of values) {
            note(label, "sees", value);
            if (seen++ === leavesAt) {
                note(label, "breaks");
                break;
            }
        }
        note(label, "ends");
    } catch (error) {
        note(label, "caught", error instanceof Error ? error.message : error);
    }
}

async function ticks(label: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await null;
        note(label, i);
    }
}

class Listing extends Array<number> {
    *[Symbol.iterator](): ArrayIterator<number> {
        note("Listing is asked for its iterator");
        for (let i = this.length; i-- > 0;)
            yield this[i];
    }
}

async function main(): Promise<void> {
    await over("empty", []);
    await over("numbers", [1, 2, 3]);
    await over("mixed", [1, "two", null, undefined, { toString: () => "five" }]);
    await over("promises", [Promise.resolve("a"), "b", Promise.resolve("c")]);
    await over("holes", [1, , 3]);
    await over("left early", [1, 2, 3, 4], 1);
    await over("rejected", [1, Promise.reject(new Error("no")), 3]);
    await over("thenable", [{ then(resolve: (value: string) => void) { note("then is called"); resolve("from then"); } }, "after"]);

    const growing = [1, 2];
    let grown = 0;
    for await (const value of growing) {
        note("growing sees", value);
        if (grown++ < 3)
            growing.push(value + 10);
    }
    const shrinking = [1, 2, 3, 4];
    for await (const value of shrinking) {
        note("shrinking sees", value);
        shrinking.pop();
    }

    const withAsync = [1, 2] as number[] & { [Symbol.asyncIterator]?: () => AsyncIterator<string> };
    withAsync[Symbol.asyncIterator] = async function* () {
        note("its own async iterator is asked for");
        yield "own async";
    };
    await over("own Symbol.asyncIterator", withAsync);

    const withSync = [1, 2];
    withSync[Symbol.iterator] = function* () {
        note("its own iterator is asked for");
        yield 7;
    } as any;
    await over("own Symbol.iterator", withSync);

    const withNull = [5, 6] as number[] & { [Symbol.asyncIterator]?: null };
    withNull[Symbol.asyncIterator] = null;
    await over("Symbol.asyncIterator is null", withNull);

    const named = [8, 9] as number[] & { name?: string };
    named.name = "has a property";
    await over("with a property", named);

    await over("subclass", Listing.from([1, 2, 3]));
    await over("frozen", Object.freeze([1, 2]));
    await over("doubles", [0.5, 1.5, -0]);
    await over("array iterator", [1, 2, 3].values());
    await over("entries", ["a", "b"].entries());
    await over("Set", new Set([1, 1, 2]));
    await over("Map", new Map([["k", 1]]));
    await over("string", "hé!");

    const inherits = Object.setPrototypeOf([1, 2], { [Symbol.iterator]: function* () { yield "from another prototype"; } }) as number[];
    await over("another prototype", inherits);

    await Promise.all([over("left", [1, 2, 3]), ticks("tick", 12), over("right", ["x", Promise.resolve("y")])]);

    let sum = 0;
    for (let round = 0; round < 200; round++) {
        for await (const value of [round, round + 1, round + 2])
            sum += value;
    }
    note("sum", sum);
    console.log(log.join("\n"));
}

main();
