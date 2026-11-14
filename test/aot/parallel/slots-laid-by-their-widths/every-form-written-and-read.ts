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
    lastFlag: boolean = true;
    lastCount: number = 3;
}

function describe(value: unknown): string {
    if (typeof value === "function")
        return "function " + String(value());
    if (typeof value === "object" && value !== null)
        return "object " + String((value as Part).name);
    if (typeof value === "number" && Object.is(value, -0))
        return "number -0";
    return typeof value + " " + String(value);
}

function show(mixed: Mixed): string {
    return [
        describe(mixed.flag), describe(mixed.count), describe(mixed.ratio), describe(mixed.text), describe(mixed.part), describe(mixed.call),
        describe(mixed.flagOrNothing), describe(mixed.countOrNothing), describe(mixed.ratioOrNothing), describe(mixed.textOrNothing), describe(mixed.partOrNothing), describe(mixed.callOrNothing),
        describe(mixed.lastFlag), describe(mixed.lastCount),
    ].join(" | ");
}

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const letters = ["a", "b", "c", "d"];
function bump(mixed: Mixed): string {
    mixed.count++;
    mixed.lastCount++;
    mixed.countOrNothing = (mixed.countOrNothing ?? 0) + 1;
    return letters[mixed.count & 3] + letters[mixed.lastCount & 3] + letters[mixed.countOrNothing & 3];
}

const first = new Mixed();
const second = new Mixed();
console.log("made", show(first));
collect();
console.log("collected", show(first));

first.flag = true;
console.log("flag", show(first));
first.count = -5;
console.log("count", show(first));
first.ratio = 2.25;
console.log("ratio", show(first));
first.text = "changed";
console.log("text", show(first));
first.part = new Part("new part");
console.log("part", show(first));
first.call = () => 70;
console.log("call", show(first));
collect();
first.flagOrNothing = false;
console.log("flagOrNothing", show(first));
first.countOrNothing = 20;
console.log("countOrNothing", show(first));
first.ratioOrNothing = -15.5;
console.log("ratioOrNothing", show(first));
first.textOrNothing = "changed too";
console.log("textOrNothing", show(first));
first.partOrNothing = new Part("other part");
console.log("partOrNothing", show(first));
first.callOrNothing = () => 80;
console.log("callOrNothing", show(first));
collect();
first.lastFlag = false;
console.log("lastFlag", show(first));
first.lastCount = 30;
console.log("lastCount", show(first));

console.log("bumped", bump(first), show(first));
console.log("bumped", bump(first), show(first));
collect();
console.log("the first", show(first));
console.log("the second", show(second));

const many: Mixed[] = [];
for (let i = 0; i < 300; i++) {
    const mixed = new Mixed();
    mixed.flag = (i & 1) === 1;
    mixed.count = i;
    mixed.ratio = i + 0.25;
    mixed.text = "text " + i;
    mixed.part = new Part("part " + i);
    mixed.call = () => i;
    mixed.lastFlag = (i & 2) === 2;
    mixed.lastCount = -i;
    many.push(mixed);
    if (i % 100 === 99)
        collect();
}
collect();
let sum = 0;
for (const mixed of many)
    sum += (mixed.flag ? 1 : 0) + mixed.count + mixed.ratio + mixed.text.length + mixed.part.name.length + mixed.call() + (mixed.lastFlag ? 1 : 0) + mixed.lastCount;
console.log("sum", String(sum));
console.log("one of many", show(many[123]));
