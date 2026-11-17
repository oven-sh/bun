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

function change(mixed: Mixed, seed: number): Mixed {
    mixed.flag = (seed & 1) === 1;
    mixed.count = seed;
    mixed.ratio = seed + 0.25;
    mixed.text = "text " + seed;
    mixed.part = new Part("part " + seed);
    mixed.call = () => seed;
    return mixed;
}

const source = change(new Mixed(), 5);
console.log("source", show(source));

const sameClass = Object.assign(new Mixed(), source);
console.log("into the same class", show(sameClass), String(sameClass instanceof Mixed), String(sameClass.part === source.part));
change(sameClass, 6);
console.log("target changed", show(sameClass));
console.log("source stays", show(source));
collect();

const plain = Object.assign({}, source);
console.log("into an empty literal", show(plain), String(plain instanceof Mixed), Object.keys(plain).join(","));

const few = Object.assign(new Mixed(), { count: 50, flag: true, text: "assigned" });
console.log("a few names", show(few));
const nothing = Object.assign(new Mixed(), { flagOrNothing: null, countOrNothing: undefined, ratioOrNothing: null, textOrNothing: undefined, partOrNothing: null, callOrNothing: undefined });
console.log("nothing", show(nothing), Object.keys(nothing).join(","));
collect();
console.log("collected", show(few));
console.log("collected", show(nothing));

const loose: any = { count: "a text in count", flag: 3, part: "a text in part", call: null, ratio: "a text in ratio", text: 4 };
const unfit = Object.assign(new Mixed(), loose);
console.log("what does not fit", show(unfit), Object.keys(unfit).join(","));
const more = Object.assign(new Mixed(), { more: "more", evenMore: 2.5 });
console.log("more names", show(more), more.more, String(more.evenMore), Object.keys(more).join(","));
const ofSeveral = Object.assign(new Mixed(), source, few, { ratio: 9.75 });
console.log("of several", show(ofSeveral));
collect();
console.log("collected", show(unfit));
console.log("collected", show(more));
console.log("collected", show(ofSeveral));

const targets: Mixed[] = [];
for (let i = 0; i < 300; i++) {
    targets.push(Object.assign(new Mixed(), change(new Mixed(), i)));
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (const each of targets)
    sum += (each.flag ? 1 : 0) + each.count + each.ratio + each.text.length + each.part.name.length + each.call();
console.log("sum", String(sum), show(targets[250]));
