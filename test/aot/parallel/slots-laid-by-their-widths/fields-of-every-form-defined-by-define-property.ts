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

function descriptor(mixed: Mixed, name: string): string {
    const found = Object.getOwnPropertyDescriptor(mixed, name);
    if (!found)
        return name + " is no property";
    return name + " " + describe(found.value) + " writable " + String(found.writable) + " enumerable " + String(found.enumerable) + " configurable " + String(found.configurable) + " get " + typeof found.get + " set " + typeof found.set;
}

function attempt(store: () => void): string {
    try {
        store();
        return "stored";
    } catch (error) {
        return (error as Error).name;
    }
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
console.log("made", show(mixed));

Object.defineProperty(mixed, "flag", { value: true });
console.log("flag keeps its attributes", show(mixed), descriptor(mixed, "flag"));
Object.defineProperty(mixed, "count", { value: 42, writable: false, enumerable: false, configurable: true });
console.log("count is read only", show(mixed), descriptor(mixed, "count"), attempt(() => { mixed.count = 43; }), show(mixed));
Object.defineProperty(mixed, "ratio", { value: 4.25, writable: true, enumerable: true, configurable: false });
console.log("ratio stays", show(mixed), descriptor(mixed, "ratio"), attempt(() => { delete (mixed as any).ratio; }), show(mixed));
collect();
console.log("collected", show(mixed), Object.keys(mixed).join(","));

let textBehindAccessor = "from the getter";
Object.defineProperty(mixed, "text", { get() { return textBehindAccessor; }, set(value: string) { textBehindAccessor = "set to " + value; }, enumerable: true, configurable: true });
console.log("text is an accessor", show(mixed), descriptor(mixed, "text"));
mixed.text = "stored";
console.log("text is stored", show(mixed));
Object.defineProperty(mixed, "part", { value: "a text in part", writable: true, enumerable: true, configurable: true });
console.log("part holds a text", show(mixed), descriptor(mixed, "part"));
Object.defineProperty(mixed, "call", { value: undefined, writable: true, enumerable: true, configurable: true });
console.log("call holds undefined", show(mixed), descriptor(mixed, "call"));
collect();
console.log("collected", show(mixed), Object.keys(mixed).join(","));

Object.defineProperty(mixed, "count", { value: 44, writable: true, enumerable: true, configurable: true });
mixed.count++;
console.log("count is plain again", show(mixed), descriptor(mixed, "count"), Object.keys(mixed).join(","));
Object.defineProperty(mixed, "text", { value: "plain again", writable: true, enumerable: true, configurable: true });
console.log("text is plain again", show(mixed), descriptor(mixed, "text"));
Object.defineProperty(mixed, "added", { value: "added", writable: true, enumerable: true, configurable: true });
console.log("a name is added", show(mixed), descriptor(mixed, "added"), Object.keys(mixed).join(","));
collect();
console.log("collected", show(mixed));

Object.freeze(mixed);
console.log("frozen", attempt(() => { mixed.otherCount = 3; }), attempt(() => { mixed.otherFlag = false; }), attempt(() => { mixed.otherText = "no"; }), show(mixed), String(Object.isFrozen(mixed)));
console.log("untouched", show(untouched), Object.keys(untouched).join(","));

export {};
