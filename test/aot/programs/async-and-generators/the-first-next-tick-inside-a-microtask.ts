// The first process.nextTick of a program, made inside a microtask: its callback runs right behind that microtask.
// Awaits before it and behind it must keep their places.
const log: string[] = [];
function note(text: string): void {
    log.push(text);
}

async function leaf(label: string, value: number): Promise<number> {
    await null;
    note(label + " leaf " + value);
    return value + 1;
}

async function chain(label: string, ticksAt: number): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const value = await leaf(label, i);
        note(label + " has " + value);
        if (i === ticksAt) {
            process.nextTick(() => note(label + " tick made at " + i));
            note(label + " asked for a tick");
            await null;
            note(label + " behind an await of null");
            await Promise.resolve(1);
            note(label + " behind an await of a fulfilled promise");
            for await (const item of [1, 2])
                note(label + " item " + item);
        }
    }
}

async function* numbers(label: string): AsyncGenerator<number> {
    for (let i = 0; i < 4; i++) {
        await null;
        yield i;
        note(label + " behind its yield of " + i);
    }
}

async function consume(label: string): Promise<void> {
    for await (const value of numbers(label))
        note(label + " sees " + value);
}

async function main(): Promise<void> {
    await chain("before any tick", -1);
    await consume("before any tick");
    await Promise.all([chain("first", 2), consume("beside")]);
    await Promise.all([chain("second", 1), consume("beside again")]);
    await chain("alone", 3);
    console.log(log.join("\n"));
}

main();
