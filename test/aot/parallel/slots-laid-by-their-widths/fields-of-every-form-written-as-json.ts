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

function collect(): void {
    let garbage: Part[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Part("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const mixed = new Mixed();
console.log(JSON.stringify(mixed));
collect();

mixed.flag = true;
mixed.count = -2147483640;
mixed.ratio = 1e21;
mixed.text = "quotes \" and \\ and \n and  ";
mixed.part = new Part("changed");
mixed.lastFlag = false;
mixed.lastCount = 2147483647;
console.log(JSON.stringify(mixed));

mixed.flagOrNothing = undefined;
mixed.countOrNothing = undefined;
mixed.ratioOrNothing = undefined;
mixed.textOrNothing = undefined;
mixed.partOrNothing = undefined;
mixed.callOrNothing = undefined;
console.log(JSON.stringify(mixed));

mixed.flagOrNothing = null;
mixed.countOrNothing = null;
mixed.ratioOrNothing = null;
mixed.textOrNothing = null;
mixed.partOrNothing = null;
mixed.callOrNothing = null;
console.log(JSON.stringify(mixed));
collect();

mixed.ratio = NaN;
mixed.ratioOrNothing = Infinity;
mixed.count = -0;
console.log(JSON.stringify(mixed));
console.log(JSON.stringify(mixed, null, 2));
console.log(JSON.stringify(mixed, ["count", "flag", "part", "name", "lastCount"]));
console.log(JSON.stringify(mixed, (key, value) => typeof value === "number" ? value + 1 : value));
console.log(JSON.stringify([mixed, new Mixed()]));
console.log(JSON.stringify({ holder: mixed, other: new Mixed() }));

const parsed = JSON.parse(JSON.stringify(new Mixed())) as Mixed;
console.log(String(parsed.flag), String(parsed.count), String(parsed.ratio), parsed.text, parsed.part.name, typeof parsed.call, String(parsed.lastFlag), String(parsed.lastCount));

let lengthOfAll = 0;
for (let i = 0; i < 300; i++) {
    const each = new Mixed();
    each.count = i;
    each.ratio = i + 0.5;
    each.text = "text " + i;
    each.flag = (i & 1) === 1;
    lengthOfAll += JSON.stringify(each).length;
    if (i % 100 === 99)
        collect();
}
console.log(String(lengthOfAll));
