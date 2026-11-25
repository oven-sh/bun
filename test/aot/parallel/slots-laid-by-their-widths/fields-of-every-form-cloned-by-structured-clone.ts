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
    call: (() => number) | undefined | null = () => 7;
    flagOrNothing: boolean | undefined | null = true;
    countOrNothing: number | undefined | null = 2;
    ratioOrNothing: number | undefined | null = 1.5;
    textOrNothing: string | undefined | null = "u";
    partOrNothing: Part | undefined | null = new Part("q");
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
        describe(mixed.flagOrNothing), describe(mixed.countOrNothing), describe(mixed.ratioOrNothing), describe(mixed.textOrNothing), describe(mixed.partOrNothing),
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

const mixed = new Mixed();
try {
    structuredClone(mixed);
    console.log("a closure was cloned");
} catch (error) {
    console.log("with a closure", (error as Error).name);
}
console.log("source", show(mixed));

mixed.call = undefined;
const clone = structuredClone(mixed);
console.log("clone", show(clone), Object.keys(clone).join(","), String(clone instanceof Mixed), String(clone.part === mixed.part), String(clone.part instanceof Part));
collect();

mixed.flag = true;
mixed.count = -7;
mixed.ratio = -0;
mixed.text = "changed";
mixed.part = new Part("changed");
mixed.call = null;
mixed.flagOrNothing = undefined;
mixed.countOrNothing = null;
mixed.ratioOrNothing = NaN;
mixed.textOrNothing = undefined;
mixed.partOrNothing = null;
mixed.lastFlag = false;
mixed.lastCount = 2147483647;
console.log("source", show(mixed));
console.log("the first clone stays", show(clone));
const second = structuredClone(mixed);
console.log("the second clone", show(second), Object.keys(second).join(","));
collect();
console.log("collected", show(second));

const shared = new Part("shared");
mixed.part = shared;
mixed.partOrNothing = shared;
const third = structuredClone(mixed);
console.log("one part twice", show(third), String(third.part === third.partOrNothing), String(third.part === shared));

const list = structuredClone([mixed, mixed]);
console.log("one object twice", String(list[0] === list[1]), show(list[0]));

let sum = 0;
for (let i = 0; i < 100; i++) {
    const each = new Mixed();
    each.call = null;
    each.count = i;
    each.ratio = i + 0.5;
    each.text = "text " + i;
    const cloned = structuredClone(each);
    sum += cloned.count + cloned.ratio + cloned.text.length + cloned.part.name.length + (cloned.lastFlag ? 1 : 0);
    if (i % 50 === 49)
        collect();
}
console.log("sum", String(sum));
