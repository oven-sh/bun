class Part {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

class Mixed {
    flag: boolean = false;
    count: number = 1;
    ratio: number = 0.5;
    text: string = "t";
    part: Part = new Part("p");
    call: () => number = () => 7;
    flagOrNothing: boolean | undefined | null = true;
    countOrNothing: number | undefined | null = 2;
    ratioOrNothing: number | undefined | null = 1.5;
    textOrNothing: string | undefined | null = "u";
    partOrNothing: Part | undefined | null = new Part("q");
    callOrNothing: (() => number) | undefined | null = () => 8;
}

function describe(value: unknown): string {
    if (typeof value === "function")
        return "function " + String(value());
    if (typeof value === "object" && value !== null)
        return "object " + String((value as Part).name);
    return typeof value + " " + String(value);
}

function walk(mixed: Mixed): string {
    const seen: string[] = [];
    for (const key in mixed)
        seen.push(key + " = " + describe(mixed[key as keyof Mixed]));
    return seen.join(" | ");
}

function entries(mixed: Mixed): string {
    const seen: string[] = [];
    for (const [key, value] of Object.entries(mixed))
        seen.push(key + " = " + describe(value));
    return seen.join(" | ");
}

function values(mixed: Mixed): string {
    return Object.values(mixed).map(describe).join(" | ");
}

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const mixed = new Mixed();
console.log("for in", walk(mixed));
console.log("entries", entries(mixed));
console.log("values", values(mixed));
collect();

mixed.flag = true;
mixed.count = -9;
mixed.ratio = 9.5;
mixed.text = "changed";
mixed.part = new Part("changed");
mixed.call = () => 70;
mixed.flagOrNothing = undefined;
mixed.countOrNothing = null;
mixed.ratioOrNothing = undefined;
mixed.textOrNothing = null;
mixed.partOrNothing = undefined;
mixed.callOrNothing = null;
console.log("for in", walk(mixed));
console.log("entries", entries(mixed));
console.log("values", values(mixed));
collect();
console.log("for in", walk(mixed));

const changedWhileWalked = new Mixed();
const seen: string[] = [];
for (const key in changedWhileWalked) {
    seen.push(key + " = " + describe(changedWhileWalked[key as keyof Mixed]));
    changedWhileWalked.count = 100;
    changedWhileWalked.textOrNothing = "stored in the walk";
    changedWhileWalked.callOrNothing = null;
}
console.log("changed while walked", seen.join(" | "));

let total = 0;
for (let i = 0; i < 300; i++) {
    const each = new Mixed();
    each.count = i;
    for (const key in each)
        total += key.length + (key === "count" ? each.count : 0);
    if (i % 100 === 99)
        collect();
}
console.log("total", String(total));
