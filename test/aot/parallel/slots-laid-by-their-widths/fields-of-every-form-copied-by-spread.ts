class Part {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

type Mixed = {
    flag: boolean;
    count: number;
    ratio: number;
    text: string;
    part: Part;
    call: () => number;
    flagOrNothing: boolean | undefined | null;
    countOrNothing: number | undefined | null;
    ratioOrNothing: number | undefined | null;
    textOrNothing: string | undefined | null;
    partOrNothing: Part | undefined | null;
    callOrNothing: (() => number) | undefined | null;
};

function make(seed: number): Mixed {
    return {
        flag: (seed & 1) === 1,
        count: seed,
        ratio: seed + 0.5,
        text: "text " + seed,
        part: new Part("part " + seed),
        call: () => seed,
        flagOrNothing: (seed & 2) === 2,
        countOrNothing: seed + 1,
        ratioOrNothing: seed + 1.5,
        textOrNothing: "other text " + seed,
        partOrNothing: new Part("other part " + seed),
        callOrNothing: () => seed + 1,
    };
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
        describe(mixed.flagOrNothing), describe(mixed.countOrNothing), describe(mixed.ratioOrNothing), describe(mixed.textOrNothing), describe(mixed.partOrNothing), describe(mixed.callOrNothing),
    ].join(" | ");
}

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const source = make(3);
console.log("source", show(source));

const copy: Mixed = { ...source };
console.log("copy", show(copy), Object.keys(copy).join(","));
console.log("shares", String(copy.part === source.part), String(copy.call === source.call), String(copy === source));
copy.flag = false;
copy.count = 30;
copy.ratio = 30.5;
copy.text = "changed";
copy.part = new Part("changed");
copy.call = () => 300;
console.log("copy changed", show(copy));
console.log("source stays", show(source));
collect();
console.log("collected", show(copy));
console.log("collected", show(source));

const replaced: Mixed = { ...source, count: 9, flagOrNothing: null, textOrNothing: undefined };
console.log("replaced", show(replaced), Object.keys(replaced).join(","));
const inFront: Mixed = { ...{ count: 9, flag: false }, ...source };
console.log("in front", show(inFront), Object.keys(inFront).join(","));
const wider = { ...source, more: "more", evenMore: 1.25 };
console.log("wider", show(wider), wider.more, String(wider.evenMore), Object.keys(wider).join(","));
const ofTwo: Mixed = { ...source, ...make(4) };
console.log("of two", show(ofTwo));
collect();

source.countOrNothing = undefined;
source.ratioOrNothing = null;
source.partOrNothing = undefined;
source.callOrNothing = null;
const withNothing: Mixed = { ...source };
console.log("with nothing", show(withNothing), Object.keys(withNothing).join(","));

const { flag, count, ...rest } = source;
console.log("rest", String(flag), String(count), Object.keys(rest).join(","), describe(rest.ratio), describe(rest.text), describe(rest.part), describe(rest.call));

const copies: Mixed[] = [];
for (let i = 0; i < 300; i++) {
    copies.push({ ...make(i) });
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (const each of copies)
    sum += (each.flag ? 1 : 0) + each.count + each.ratio + each.text.length + each.part.name.length + each.call();
console.log("sum", String(sum), show(copies[200]));
