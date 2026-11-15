class Part {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

class Mixed {
    flag?: boolean = false;
    count?: number = 1;
    ratio?: number = 0.5;
    text?: string = "t";
    part?: Part = new Part("p");
    call?: () => number = () => 7;
    otherFlag: boolean = true;
    otherCount: number = 2;
    otherRatio: number = 1.5;
    otherText: string = "u";
    otherPart: Part = new Part("q");
    otherCall: () => number = () => 8;
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

function keys(mixed: Mixed): string {
    return Object.keys(mixed).join(",");
}

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const mixed = new Mixed();
const untouched = new Mixed();
console.log("made", show(mixed), keys(mixed));

console.log("delete flag", String(delete mixed.flag), show(mixed), keys(mixed), String("flag" in mixed));
console.log("delete count", String(delete mixed.count), show(mixed), keys(mixed), String("count" in mixed));
console.log("delete ratio", String(delete mixed.ratio), show(mixed), keys(mixed), String("ratio" in mixed));
collect();
console.log("collected", show(mixed), keys(mixed));
console.log("delete text", String(delete mixed.text), show(mixed), keys(mixed), String("text" in mixed));
console.log("delete part", String(delete mixed.part), show(mixed), keys(mixed), String("part" in mixed));
console.log("delete call", String(delete mixed.call), show(mixed), keys(mixed), String("call" in mixed));
collect();
console.log("collected", show(mixed), keys(mixed));
console.log("delete again", String(delete mixed.call), show(mixed), keys(mixed));

mixed.call = () => 70;
console.log("call again", show(mixed), keys(mixed));
mixed.part = new Part("again");
console.log("part again", show(mixed), keys(mixed));
mixed.text = "again";
console.log("text again", show(mixed), keys(mixed));
mixed.ratio = 10.5;
console.log("ratio again", show(mixed), keys(mixed));
mixed.count = 10;
console.log("count again", show(mixed), keys(mixed));
mixed.flag = true;
console.log("flag again", show(mixed), keys(mixed));
collect();
console.log("collected", show(mixed), keys(mixed));
console.log("untouched", show(untouched), keys(untouched));
