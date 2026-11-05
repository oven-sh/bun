// Flags: --aot-allow-code-from-disk
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "lists-that-say-what-they-hold-"));
writeFileSync(join(folder, "spreads.mjs"), `
export function spreadAround(list, deed) { return [...list, ...deed()]; }
function all(...given) { return given; }
export function passAround(list, deed) { return all(...list, ...deed()); }
`);
const { spreadAround, passAround } = await import(join(folder, "spreads.mjs"));

class Crate {
    tag: string;
    load: number;
    constructor(tag: string, load: number) {
        this.tag = tag;
        this.load = load;
    }
}

function stock(count: number): Crate[] {
    const shelf: Crate[] = [];
    for (let i = 0; i < count; i++)
        shelf.push(new Crate("c" + i, i));
    return shelf;
}

function weighByIndex(shelf: Crate[]): number {
    let sum = 0;
    for (let i = 0; i < shelf.length; i++)
        sum += shelf[i].load;
    return sum;
}

function weighByStep(shelf: Crate[]): number {
    let sum = 0;
    for (const crate of shelf)
        sum += crate.load;
    return sum;
}

function attempt(deed: () => unknown): unknown {
    try {
        return deed();
    } catch (error) {
        return "threw " + (error as Error).name;
    }
}

function put(shelf: Crate[], at: number, item: Crate): void {
    shelf[at] = item;
}

function add(shelf: Crate[], item: Crate): number {
    return shelf.push(item);
}

function meddle(shelf: Crate[], round: number): Crate[] {
    shelf[0] = new Crate("meddled", round + 500);
    shelf.push(new Crate("meddled", round + 500));
    return [];
}

function gather(...all: Crate[]): Crate[] {
    return all;
}

function gatherAndStore(shelf: Crate[], round: number, ...all: Crate[]): Crate[] {
    shelf[0] = new Crate("meddled", round + 500);
    shelf.push(new Crate("meddled", round + 500));
    return all;
}

function keep(shelf: Crate[]): Crate[] {
    return shelf;
}

class Pallet {
    all: Crate[];
    constructor(...all: Crate[]) {
        this.all = all;
    }
}

function turn(round: number): string {
    const shelf = stock(5);
    const other = stock(2);
    const first = spreadAround(shelf, () => meddle(shelf, round));
    shelf[1] = new Crate("swapped", round + 100);
    shelf.push(new Crate("pushed", round + 200));
    const second = spreadAround(shelf, () => meddle(shelf, round));
    shelf[2] = new Crate("again", round + 300);
    shelf.push(new Crate("last", round + 400));
    return String(JSON.stringify(first)) + " | " + String(JSON.stringify(second)) + " | " + JSON.stringify(shelf) + " | " + Object.keys(shelf).length + " | " + JSON.stringify(other) + " | " + String(attempt(() => weighByIndex(shelf))) + " | " + String(attempt(() => weighByStep(shelf)));
}

for (let round = 0; round < 3; round++)
    console.log(turn(round));
