// Functions that yield a number are held in places of two types: "yields a number" and "yields a number or nothing", and the program has more calls through the second. A call of what such a place holds takes the number as it is, without a box, from an entry that the function has for one kind of call. A function has that entry for the calls that take the number as the function itself yields it, however many calls of another kind there are.
// IR- ^function f\d+ "one" \w+ role=SignatureEntrypoint
// IR- ^function f\d+ "half" \w+ role=SignatureEntrypoint
// IR- ^function f\d+ "counts" \w+ role=SignatureEntrypoint
// IR+ ^function f\d+ "one" Arrow .* -> number( |$)
// IR+ ^function f\d+ "either" Arrow .* -> undefined\|number( |$)
const lines: string[] = [];
let count = 0;
const one = (): number => 1;
const two = (): number => 2;
const three = (): number => 3;
const half = (): number => 0.5;
const counts = (): number => ++count;
const large = (): number => 2 ** 40 + count;
const negativeZero = (): number => -0;
const notANumber = (): number => NaN;
const either = (): number | undefined => (count & 1 ? undefined : count);
const nothing = (): undefined => undefined;
const rows: (() => number)[] = [one, two, three, half, counts, large, negativeZero, notANumber];
const maybe: (() => number | undefined)[] = [one, half, counts, either, nothing, notANumber];
function sumOf(row: number, turns: number): number { const f = rows[row]; let sink = 0; for (let i = 0; i < turns; i++) sink += f(); return sink; }
function sumOfMaybe(row: number, turns: number): number { const f = maybe[row]; let sink = 0; for (let i = 0; i < turns; i++) { const got = f(); sink += got === undefined ? 100 : got; } return sink; }
function firstOfMaybe(row: number): string { const got = maybe[row](); return got === undefined ? "nothing" : String(got); }
function isSomething(row: number): boolean { return maybe[row]() !== undefined; }
for (let row = 0; row < rows.length; row++) lines.push(rows[row].name + " " + sumOf(row, 5) + " " + Object.is(sumOf(row, 1), -0) + " " + count);
for (let row = 0; row < maybe.length; row++) lines.push("maybe " + maybe[row].name + " " + sumOfMaybe(row, 5) + " " + firstOfMaybe(row) + " " + isSomething(row) + " " + count);
console.log(lines.join("\n"));
