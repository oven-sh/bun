// Functions with number parameters (plain, optional, nullable, with a default) called through a value of type any get every kind of number, undefined and null across, and hand the same value back.
function identity(value: number): number {
    return value;
}
function optional(value?: number): number | undefined {
    return value;
}
function nullable(value: number | null): number | null {
    return value;
}
function both(value?: number | null): number | null | undefined {
    return value;
}
function withDefault(value: number = 7): number {
    return value;
}
function sum(a: number, b: number, c?: number): number {
    return a + b + (c ?? 100);
}
function index(values: number[], at: number): number | undefined {
    return values[at];
}

function bits(a: number, b: number): number {
    return (a | 0) ^ (b << 1);
}

function show(value: unknown): string {
    return Object.is(value, -0) ? "-0" : String(value);
}

const table: any = JSON.parse('{"zero":0,"five":5,"negative":-5,"large":4294967296,"huge":1e300,"half":0.5,"nothing":null}');
const doubles = new Float64Array([5, -0, NaN, Infinity, -Infinity, 2147483648, -2147483649]);
const storedAsDoubles: any = JSON.parse("[0.5, 5, 0, -5, 4294967296]");
const numbers: any[] = [table.zero, table.five, table.negative, table.large, table.huge, table.half, 2147483647, -2147483648, ...doubles, storedAsDoubles[1], storedAsDoubles[2], storedAsDoubles[3], storedAsDoubles[4]];
const functions: any = { identity, optional, nullable, both, withDefault };

for (let round = 0; round < 3; ++round) {
    const lines: string[] = [];
    for (const name of Object.keys(functions)) {
        const called = functions[name];
        lines.push(name + ": " + numbers.map(value => show(called(value))).join(" "));
    }
    lines.push("optional: " + show(functions.optional()) + " " + show(functions.optional(undefined)));
    lines.push("nullable: " + show(functions.nullable(table.nothing)));
    lines.push("both: " + show(functions.both()) + " " + show(functions.both(undefined)) + " " + show(functions.both(table.nothing)));
    lines.push("withDefault: " + show(functions.withDefault()) + " " + show(functions.withDefault(undefined)));
    const untypedSum: any = sum;
    lines.push("sum: " + numbers.map(value => show(untypedSum(value, table.half))).join(" "));
    lines.push("sum: " + numbers.map(value => show(untypedSum(table.five, value, value))).join(" "));
    const untypedIndex: any = index;
    lines.push("index: " + [table.zero, table.five, doubles[0], 1, 2, storedAsDoubles[2]].map(value => show(untypedIndex([10, 20, 30], value))).join(" "));
    const untypedBits: any = bits;
    lines.push("bits: " + numbers.map(value => show(untypedBits(value, storedAsDoubles[1]))).join(" "));
    if (round === 2)
        console.log(lines.join("\n"));
}
