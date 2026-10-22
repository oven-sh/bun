// Math.trunc in front of an operator that converts its operand to an int32 answers as in plain Bun for every kind of number, and so do floor, ceil and round, which differ from it for fractions.
const texts = ["0", "-0", "0.5", "-0.5", "0.9999999", "-0.9999999", "1.5", "-1.5", "31.9", "32.1", "-31.9", "33", "2147483647", "2147483647.9", "2147483648", "2147483648.5", "-2147483648", "-2147483648.9", "-2147483649.5",
    "4294967295.5", "4294967296", "4294967296.5", "4294967297.25", "-4294967296.5", "9007199254740991", "9007199254740992", "-9007199254740993", "9223372036854775808", "-9223372036854775808", "18446744073709551616",
    "1e21", "-1e21", "1e300", "-1e300", "5e-324", "-5e-324", "NaN", "Infinity", "-Infinity"];
const values: number[] = texts.map(Number);

function truncated(x: number): string {
    return [Math.trunc(x) | 0, Math.trunc(x) & 255, Math.trunc(x) ^ 1, ~Math.trunc(x), Math.trunc(x) >> 1, Math.trunc(x) >>> 0, Math.trunc(x) << 1, 3 << Math.trunc(x), -9 >> Math.trunc(x), -9 >>> Math.trunc(x)].join();
}
function truncatedTwice(x: number, y: number): number {
    return Math.trunc(x) ^ Math.trunc(y);
}
function truncatedAndRead(x: number): string {
    const whole = Math.trunc(x);
    return (whole | 0) + "/" + (Object.is(whole, -0) ? "-0" : whole);
}
function truncatedQuotient(x: number, y: number): number {
    return Math.trunc(x / y) | 0;
}
function roundedOtherwise(x: number): string {
    return [Math.floor(x) | 0, Math.ceil(x) | 0, Math.round(x) | 0, Math.floor(x) >>> 0, ~Math.ceil(x), 1 << Math.round(x)].join();
}
function notConverted(x: number): string {
    return [Math.trunc(x) + 0, Math.trunc(x) * 1, Math.trunc(x) % 7].map(y => (Object.is(y, -0) ? "-0" : String(y))).join();
}

for (let round = 0; round < 3; ++round) {
    const lines: string[] = [];
    for (let i = 0; i < values.length; ++i) {
        const x = values[i];
        const y = values[(i + 7) % values.length];
        lines.push([texts[i], truncated(x), truncatedTwice(x, y), truncatedAndRead(x), truncatedQuotient(x, y), truncatedQuotient(i - 20, 7), roundedOtherwise(x), notConverted(x)].join(" "));
    }
    if (round === 2)
        console.log(lines.join("\n"));
}
