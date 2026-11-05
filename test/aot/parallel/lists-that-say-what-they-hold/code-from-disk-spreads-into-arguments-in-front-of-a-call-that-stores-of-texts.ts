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

function stock(count: number): string[] {
    const shelf: string[] = [];
    for (let i = 0; i < count; i++)
        shelf.push("c" + i);
    return shelf;
}

function weighByIndex(shelf: string[]): number {
    let sum = 0;
    for (let i = 0; i < shelf.length; i++)
        sum += shelf[i].length;
    return sum;
}

function weighByStep(shelf: string[]): number {
    let sum = 0;
    for (const crate of shelf)
        sum += crate.length;
    return sum;
}

function attempt(deed: () => unknown): unknown {
    try {
        return deed();
    } catch (error) {
        return "threw " + (error as Error).name;
    }
}

function put(shelf: string[], at: number, item: string): void {
    shelf[at] = item;
}

function add(shelf: string[], item: string): number {
    return shelf.push(item);
}

function meddle(shelf: string[], round: number): string[] {
    shelf[0] = ("meddled" + round + 500);
    shelf.push(("meddled" + round + 500));
    return [];
}

function gather(...all: string[]): string[] {
    return all;
}

function gatherAndStore(shelf: string[], round: number, ...all: string[]): string[] {
    shelf[0] = ("meddled" + round + 500);
    shelf.push(("meddled" + round + 500));
    return all;
}

function keep(shelf: string[]): string[] {
    return shelf;
}

class Pallet {
    all: string[];
    constructor(...all: string[]) {
        this.all = all;
    }
}

function turn(round: number): string {
    const shelf = stock(5);
    const other = stock(2);
    const first = passAround(shelf, () => meddle(shelf, round));
    shelf[1] = ("swapped" + round + 100);
    shelf.push(("pushed" + round + 200));
    const second = passAround(shelf, () => meddle(shelf, round));
    shelf[2] = ("again" + round + 300);
    shelf.push(("last" + round + 400));
    return String(JSON.stringify(first)) + " | " + String(JSON.stringify(second)) + " | " + JSON.stringify(shelf) + " | " + Object.keys(shelf).length + " | " + JSON.stringify(other) + " | " + String(attempt(() => weighByIndex(shelf))) + " | " + String(attempt(() => weighByStep(shelf)));
}

for (let round = 0; round < 3; round++)
    console.log(turn(round));
