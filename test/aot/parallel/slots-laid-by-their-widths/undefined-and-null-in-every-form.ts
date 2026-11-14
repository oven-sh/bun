class Part {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

class Mixed {
    flag: boolean | undefined | null = false;
    count: number | undefined | null = 1;
    ratio: number | undefined | null = 0.5;
    text: string | undefined | null = "t";
    part: Part | undefined | null = new Part("p");
    call: (() => number) | undefined | null = () => 7;
    otherFlag: boolean | undefined | null = true;
    otherCount: number | undefined | null = 2;
    otherRatio: number | undefined | null = 1.5;
    otherText: string | undefined | null = "u";
    otherPart: Part | undefined | null = new Part("q");
    otherCall: (() => number) | undefined | null = () => 8;
}

function describe(value: unknown): string {
    if (typeof value === "function")
        return "function " + String(value());
    if (typeof value === "object" && value !== null)
        return "object " + String((value as Part).name);
    return typeof value + " " + String(value);
}

function show(mixed: Mixed): string {
    return [
        describe(mixed.flag), describe(mixed.count), describe(mixed.ratio), describe(mixed.text), describe(mixed.part), describe(mixed.call),
        describe(mixed.otherFlag), describe(mixed.otherCount), describe(mixed.otherRatio), describe(mixed.otherText), describe(mixed.otherPart), describe(mixed.otherCall),
    ].join(" | ");
}

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

function count(mixed: Mixed): number {
    return (mixed.flag === undefined ? 1 : 0) + (mixed.count === undefined ? 2 : 0) + (mixed.ratio === undefined ? 4 : 0) + (mixed.text === undefined ? 8 : 0) + (mixed.part === undefined ? 16 : 0) + (mixed.call === undefined ? 32 : 0)
        + (mixed.flag === null ? 64 : 0) + (mixed.count === null ? 128 : 0) + (mixed.ratio === null ? 256 : 0) + (mixed.text === null ? 512 : 0) + (mixed.part === null ? 1024 : 0) + (mixed.call === null ? 2048 : 0);
}

const mixed = new Mixed();
const untouched = new Mixed();
console.log("made", String(count(mixed)), show(mixed));

mixed.flag = undefined;
console.log("flag undefined", String(count(mixed)), show(mixed));
mixed.count = undefined;
console.log("count undefined", String(count(mixed)), show(mixed));
mixed.ratio = undefined;
console.log("ratio undefined", String(count(mixed)), show(mixed));
mixed.text = undefined;
console.log("text undefined", String(count(mixed)), show(mixed));
mixed.part = undefined;
console.log("part undefined", String(count(mixed)), show(mixed));
mixed.call = undefined;
console.log("call undefined", String(count(mixed)), show(mixed));
collect();
console.log("collected", String(count(mixed)), show(mixed));

mixed.flag = null;
console.log("flag null", String(count(mixed)), show(mixed));
mixed.count = null;
console.log("count null", String(count(mixed)), show(mixed));
mixed.ratio = null;
console.log("ratio null", String(count(mixed)), show(mixed));
mixed.text = null;
console.log("text null", String(count(mixed)), show(mixed));
mixed.part = null;
console.log("part null", String(count(mixed)), show(mixed));
mixed.call = null;
console.log("call null", String(count(mixed)), show(mixed));
collect();
console.log("collected", String(count(mixed)), show(mixed));

mixed.flag = true;
console.log("flag again", String(count(mixed)), show(mixed));
mixed.count = 10;
console.log("count again", String(count(mixed)), show(mixed));
mixed.ratio = 10.5;
console.log("ratio again", String(count(mixed)), show(mixed));
mixed.text = "again";
console.log("text again", String(count(mixed)), show(mixed));
mixed.part = new Part("again");
console.log("part again", String(count(mixed)), show(mixed));
mixed.call = () => 70;
console.log("call again", String(count(mixed)), show(mixed));
collect();
console.log("collected", String(count(mixed)), show(mixed));

console.log("keys", Object.keys(mixed).join(","));
console.log("has", String("flag" in mixed), String("call" in mixed), String(Object.hasOwn(mixed, "ratio")));
console.log("untouched", String(count(untouched)), show(untouched));
