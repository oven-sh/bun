// A loop reads the characters of a string and awaits after each read. During the first await the string is used as a property key, which swaps its characters for those of an equal key, and a collection frees the old ones.
const table: Record<string, number> = {};
const retained: string[] = [];
let keyToLookUp: string | undefined;
let lookups = 0;

function build(firstUnit: number, seed: number, length: number): string {
    const units: number[] = [];
    for (let i = 0; i < length; i++)
        units.push(firstUnit + (seed + i * 7) % 26);
    return String.fromCharCode(...units);
}

async function tick(): Promise<void> {
    const key = keyToLookUp;
    if (key === undefined)
        return;
    keyToLookUp = undefined;
    lookups += table[key];
    Bun.gc(true);
    for (let i = 0; i < 200; i++)
        retained.push(build(65, i, key.length));
}

async function sumCodeUnits(key: string): Promise<number> {
    let n = 0;
    for (let i = 0; i < key.length; i++) {
        n += key.charCodeAt(i);
        await tick();
    }
    return n;
}

async function main(): Promise<void> {
    for (let round = 0; round < 50; round++) {
        const length = 20 + round % 5;
        const other = build(97, round, length);
        table[other] = round;
        const key = build(97, round, length);
        retained.length = 0;
        keyToLookUp = key;
        console.log(await sumCodeUnits(key));
    }
    console.log(lookups);
}

main();
