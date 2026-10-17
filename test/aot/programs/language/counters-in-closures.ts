declare const console: { log(...values: unknown[]): void };
function makeCounter(start: number) {
    var value: number = start;
    var other: number | undefined;
    return {
        up(): number { value++; return value; },
        down(): number { value--; return value; },
        twice(): number { value = value * 2; return value; },
        plus(step: number): number { value += step; return value; },
        set(next: number): void { value = next; },
        setOther(next: number | undefined): void { other = next; },
        both(): number { return value + (other ?? -1) + 1; },
        isBig(): boolean { return value >= 65536; },
        half(): number { return value * 0.5 - 1; },
    };
}
function describe(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
const starts = [0, -0, 1, -1, 0.5, -0.5, 1.5, 65535, 65536, 2147483647, -2147483648, 4294967295, 9007199254740991, 9007199254740992, -9007199254740992, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity];
for (let round = 0; round < 2; round++) {
    for (const start of starts) {
        const counter = makeCounter(start);
        const row: string[] = [describe(counter.up()), describe(counter.up()), describe(counter.down()), describe(counter.down()), describe(counter.down()), describe(counter.twice()), describe(counter.plus(1)), describe(counter.plus(-1)), describe(counter.half()), String(counter.isBig()), describe(counter.both())];
        counter.setOther(start); row.push(describe(counter.both())); counter.setOther(undefined); row.push(describe(counter.both()));
        console.log(describe(start) + ": " + row.join(" "));
    }
}
function sumTo(limit: number): number { let total = 0.5; for (let x = 0.25; x < limit; x += 1) total += x * 2 - 1; return total; }
console.log(sumTo(1000), sumTo(0), sumTo(NaN), sumTo(1.25));
