const launder = new Function("v", "return v") as <V>(v: V) => V;

class Counters {
    up: number;
    down: number;
    any: number;
    other: number;
    constructor(start: number) {
        this.up = start | 0;
        this.down = start | 0;
        this.any = start | 0;
        this.other = 7;
    }
}

let total = 0;
let steps = 0;

function increment(c: Counters): void { c.up++; c.any++; }
function addThree(c: Counters): void { c.up += 3; c.any += 3; }
function decrement(c: Counters): void { c.down--; c.any--; }
function addSmall(c: Counters, v: number): void { c.up += v; c.any += v; }
function addAnySign(c: Counters, v: number): void { c.up += v; c.down += v; c.any += v; }
function subtractAnySign(c: Counters, v: number): void { c.up -= v; c.down -= v; c.any -= v; }
function addField(c: Counters): void { c.up += c.other; c.down -= c.other; }
function oldValue(c: Counters): number { return c.up++ + c.down--; }
function newValue(c: Counters): number { return ++c.up + --c.down; }
function addToVariables(v: number): void { total += v; steps++; total -= 1; }
function makeCounter(start: number): (v: number) => number {
    let count = start | 0;
    return (v: number) => { count++; count += v; count -= 2; return count; };
}

function show(label: string, c: Counters): void {
    console.log(label, c.up, c.down, c.any, c.other, Object.is(c.up, -0), typeof c.up);
}

const starts = [0, 1, -1, 2147483640, 2147483646, 2147483647, -2147483640, -2147483643, -2147483644, -2147483645, -2147483647, -2147483648];
const addends = [0, 1, 2, 3, -1, -2, -3, 5, -5, 8, -8, 2147483647, -2147483647, -2147483648, 1073741824, -1073741824];

for (const start of starts) {
    const c = launder(new Counters(start));
    for (let round = 0; round < 12; ++round) {
        increment(c);
        if (round % 4 === 3)
            show("increment " + start, c);
    }
    const d = launder(new Counters(start));
    for (let round = 0; round < 12; ++round) {
        decrement(d);
        if (round % 4 === 3)
            show("decrement " + start, d);
    }
    const e = launder(new Counters(start));
    for (let round = 0; round < 6; ++round)
        addThree(e);
    show("three " + start, e);
    const f = launder(new Counters(start));
    for (let round = 0; round < 9; ++round)
        addSmall(f, round & 3);
    show("small " + start, f);
    const g = launder(new Counters(start));
    let sum = 0;
    for (let round = 0; round < 10; ++round)
        sum += oldValue(g) + newValue(g);
    show("values " + start + " " + sum, g);
    const h = launder(new Counters(start));
    for (let round = 0; round < 4; ++round)
        addField(h);
    show("field " + start, h);
    for (const addend of addends) {
        const a = launder(new Counters(start));
        addAnySign(a, addend);
        show("add " + start + " " + addend, a);
        addAnySign(a, addend);
        subtractAnySign(a, 1);
        show("again " + start + " " + addend, a);
        const s = launder(new Counters(start));
        subtractAnySign(s, addend);
        show("subtract " + start + " " + addend, s);
        subtractAnySign(s, addend);
        addAnySign(s, -1);
        show("again " + start + " " + addend, s);
        total = start | 0;
        steps = start | 0;
        addToVariables(addend);
        addToVariables(addend);
        console.log("variables", start, addend, total, steps);
        const counter = launder(makeCounter(start));
        console.log("captured", start, addend, counter(addend), counter(addend), counter(1));
    }
}

const fraction = launder(new Counters(5));
fraction.up = 1.5;
fraction.down = -0;
fraction.any = NaN;
increment(fraction);
decrement(fraction);
addAnySign(fraction, 2);
show("fraction", fraction);

const frozen = launder(Object.freeze(new Counters(2147483647)));
try {
    increment(frozen);
} catch (error) {
    console.log((error as Error).constructor.name);
}
show("frozen", frozen);

const odd = launder(new Counters(2147483647)) as unknown as { up: unknown; any: unknown };
odd.up = "text";
odd.any = undefined;
increment(odd as unknown as Counters);
console.log("odd", odd.up, odd.any);
