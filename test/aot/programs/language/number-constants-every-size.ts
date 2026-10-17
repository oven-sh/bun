// Arithmetic and comparisons of numbers that are not known to be integers with constants of every size.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function steps(x: number): string {
    return [x + 1, x - 1, x + 2, x * 2, x / 2, x + 0.5, x - 0.5, x * -1, x + 127, x + 128, x - 128, x + 0, x - 0, x * 0, x * 1, x + -0, 1 - x, 2 / x, -1 * x, 100 % x].map(show).join(" ");
}
function compared(x: number): string {
    return [x < 1, x <= 1, x > -1, x >= -1, x === 92, x !== 92, x < 127, x < 128, x === 0, x === -0, x < 4294967296, x >= -4294967296, x < 2147483648, x >= -2147483648, x <= 9007199254740992, x > 0.5, x === 1e21, x < 5e-324].map(v => v ? "y" : "n").join("");
}
function chosen(x: number, which: boolean): string { const picked = which ? 1 : x > 3 ? 2 : -1; return show(x + picked) + " " + show(which ? x : 64) + " " + show(Math.max(x, 1)) + " " + show(Math.min(x, 127)); }
function counted(from: number, to: number): string { let turns = 0, at = from; while (at < to && turns < 6) { at += 1; turns++; } let back = to; while (back > from && turns < 12) { back -= 2; turns++; } return show(at) + " " + show(back) + " " + turns; }
const numbers = [0, -0, 1, -1, 0.5, -0.5, 2, 91.5, 92, 126.5, 127, 128, 129, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, -4294967296, 9007199254740991, 9007199254740992, 1e21, 5e-324, NaN, Infinity, -Infinity];
const holder = { value: 0.25 };
for (const n of numbers) {
    holder.value = n;
    console.log(show(n), "|", steps(holder.value), "|", compared(holder.value), "|", chosen(holder.value, n > 1), "|", chosen(holder.value, false), "|", counted(holder.value, holder.value + 3.5));
}
