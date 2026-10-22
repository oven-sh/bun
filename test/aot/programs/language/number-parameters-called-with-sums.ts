const launder = new Function("value", "return value") as <T>(value: T) => T;

function half(value: number): number {
    return value / 2;
}

function low(value: number): number {
    return value | 0;
}

function describe(value: number): string {
    return typeof value + " " + String(value) + " " + Object.is(value, -0);
}

function next(value: number): number {
    return half(value + 1) + low(value + 2);
}

function text(value: number): string {
    return describe(value + 1);
}

class Counter {
    total = 0;
    add(step: number): number {
        this.total = this.total + low(step + 1);
        return this.total;
    }
}

for (let i = 0; i < 4; i++)
    console.log(next(i), text(i));

const openedNext = launder(next);
const openedText = launder(text);
const values: unknown[] = [0, 1, -1, 2147483646, 2147483647, -2147483648, -2147483649, 4294967296, 0.5, -0.5, -1.5, 1e21, NaN, Infinity, -Infinity, -0, "4", "", "x", undefined, null, true, [], [5], {}, { valueOf() { return 6; } }, 7n];
for (const value of values) {
    try {
        console.log(openedNext(value as number), openedText(value as number));
    } catch (error) {
        console.log((error as Error).constructor.name);
    }
}

const counter = launder(new Counter());
for (const value of values) {
    try {
        console.log(counter.add(value as number));
    } catch (error) {
        console.log((error as Error).constructor.name);
    }
}
