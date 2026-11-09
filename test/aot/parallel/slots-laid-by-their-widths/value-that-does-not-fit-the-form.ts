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

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const letters = ["a", "b", "c", "d"];
function bump(mixed: Mixed): string {
    mixed.otherCount++;
    return letters[mixed.otherCount & 3];
}

function storeLoosely(target: any, step: number): void {
    switch (step) {
    case 0:
        target.count = "a text in count";
        break;
    case 1:
        target.flag = 5;
        break;
    case 2:
        target.ratio = "a text in ratio";
        break;
    case 3:
        target.text = 9;
        break;
    case 4:
        target.part = "a text in part";
        break;
    case 5:
        target.call = 3.5;
        break;
    case 6:
        target.count = { name: "an object in count" };
        break;
    case 7:
        target.flag = () => 55;
        break;
    case 8:
        target.text = true;
        break;
    case 9:
        target.part = 12;
        break;
    case 10:
        target.call = new Part("a part in call");
        break;
    case 11:
        target.ratio = false;
        break;
    }
}

const mixed = new Mixed();
const untouched = new Mixed();
console.log("made", show(mixed));
for (let step = 0; step < 12; step++) {
    storeLoosely(mixed, step);
    console.log("step " + step, bump(mixed), show(mixed));
    if (step % 4 === 3) {
        collect();
        console.log("collected", show(mixed));
    }
}
console.log("keys", Object.keys(mixed).join(","));

mixed.flag = true;
mixed.count = 100;
mixed.ratio = 100.5;
mixed.text = "fits again";
mixed.part = new Part("fits again");
mixed.call = () => 700;
console.log("fits again", show(mixed));
collect();
console.log("collected", show(mixed));
console.log("keys", Object.keys(mixed).join(","));
console.log("untouched", show(untouched));

const fresh = new Mixed();
storeLoosely(fresh, 0);
fresh.otherCount = 21;
fresh.flag = true;
console.log("fresh", show(fresh));
