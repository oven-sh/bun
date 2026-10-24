// A test narrows a value on each of its sides, and the blocks behind it take what came in one form in the form of the narrower type: a number out of a box, nothing at all for undefined.
declare const console: { log(...values: unknown[]): void };

function describe(value: number | string | undefined | null | boolean): string {
    if (value === undefined) return "undefined " + String(value);
    if (value === null) return "null " + String(value);
    if (typeof value === "number") return "number " + (value + 1) + " " + (value | 0) + " " + value.toFixed(1);
    if (typeof value === "boolean") return "boolean " + (value ? 1 : 0) + " " + !value;
    return "string " + value.length + " " + value.toUpperCase();
}

function orZero(value: number | undefined): number { return value === undefined ? 0 : value * 2; }
function joined(flag: boolean, a: number, b: number | undefined): unknown {
    const picked = flag ? a : b;
    if (picked === undefined) return [picked, "nothing"];
    return [picked, picked + 0.5];
}
function inLoop(values: (number | undefined)[]): number {
    let sum = 0, last: number | undefined = undefined;
    for (const value of values) {
        if (value !== undefined) { sum += value; last = value; }
        else if (last !== undefined) sum -= last;
    }
    return sum;
}
function byCase(value: 1 | 2 | "three" | undefined): unknown {
    switch (value) {
    case 1: return value + 10;
    case 2: return value / 4;
    case "three": return value + "!";
    default: return [value];
    }
}

for (const value of [undefined, null, 4, 4.5, -0, true, false, "", "text"]) console.log(describe(value));
console.log(orZero(undefined), orZero(3), orZero(1.25));
console.log(JSON.stringify([joined(true, 1, 2), joined(false, 1, 2.5), joined(false, 1, undefined)]));
console.log(inLoop([1, undefined, 2.5, undefined, undefined, 4]));
console.log(JSON.stringify([byCase(1), byCase(2), byCase("three"), byCase(undefined)]));
