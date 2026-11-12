class Counters {
    before: boolean = true;
    count: number = 0;
    between: boolean = false;
    other: number = 0;
    ratio: number = 0.5;
    after: boolean = true;
    last: number | undefined | null = 0;
}

function describe(value: unknown): string {
    if (typeof value === "number" && Object.is(value, -0))
        return "number -0";
    return typeof value + " " + String(value);
}

function show(counters: Counters): string {
    return [describe(counters.before), describe(counters.count), describe(counters.between), describe(counters.other), describe(counters.ratio), describe(counters.after), describe(counters.last)].join(" | ");
}

const letters = ["a", "b", "c", "d"];
function bump(counters: Counters): string {
    counters.count++;
    counters.other++;
    return letters[counters.count & 3] + letters[counters.other & 3];
}

const counters = new Counters();
console.log("made", bump(counters), show(counters));

const edges: number[] = [
    2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642,
    2147483648, -2147483649, 4294967295, 4294967296, 4611686018427387904, 9007199254740991, -9007199254740991, 9007199254740992,
    0.5, -0.5, -0, 0, NaN, Infinity, -Infinity, 1e308, 5e-324, 1,
];
for (const edge of edges) {
    counters.count = edge;
    console.log("count", show(counters));
    counters.other = edge;
    console.log("other", show(counters));
    counters.last = edge;
    console.log("last", show(counters));
    counters.ratio = edge;
    console.log("ratio", show(counters));
}
Bun.gc(true);
console.log("collected", show(counters));

const words = new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffa000000000000n, 0x7ff8000000000001n, 0x7ffa000000000001n]);
const numbers = new Float64Array(words.buffer);
for (let i = 0; i < numbers.length; i++) {
    counters.ratio = numbers[i];
    counters.last = numbers[i];
    counters.count = numbers[i];
    console.log("not a number", String(i), show(counters), String(counters.ratio === undefined), String(counters.last === undefined), String(counters.last === null));
}

counters.count = 5;
counters.other = 6;
counters.ratio = 7.5;
counters.last = undefined;
console.log("undefined", bump(counters), show(counters));
counters.last = null;
console.log("null", bump(counters), show(counters));
counters.last = -2147483647;
console.log("a marker's bits", bump(counters), show(counters));
counters.before = false;
counters.between = true;
counters.after = false;
console.log("booleans", show(counters));
