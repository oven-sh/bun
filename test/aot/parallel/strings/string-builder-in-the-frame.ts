// A text that is built by `+=` starts in the frame of the function and moves to the heap when it outgrows the frame.
function checksum(text: string): string {
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    return text.length + ":" + sum + ":" + text.slice(0, 12) + ".." + text.slice(-12);
}
function joinNumbers(values: number[]): string {
    let text = "";
    for (const value of values) {
        if (text.length) text += ",";
        text += value;
    }
    return text;
}
function joinStrings(values: string[], separator: string): string {
    let text = "";
    for (let i = 0; i < values.length; i++) {
        if (i) text += separator;
        text += values[i];
    }
    return text;
}
function joinAnything(values: unknown[]): string {
    let text = "";
    for (const value of values) text += value + ";";
    return text;
}
function joinOptional(values: (string | undefined | null)[]): string {
    let text = "";
    for (const value of values) { text += value; text += "|"; }
    return text;
}
function joinBooleans(values: boolean[]): string {
    let text = "";
    for (const value of values) { text += value; text += " "; }
    return text;
}
function repeat(piece: string, count: number): string {
    let text = "";
    for (let i = 0; i < count; i++) text += piece;
    return text;
}
function lengths(piece: string, count: number): string {
    let text = "", seen = "";
    for (let i = 0; i < count; i++) { text += piece; if ((i & 15) === 0) seen += text.length + " "; }
    return seen + checksum(text);
}
function pieces(source: string, step: number): string {
    let text = "";
    for (let i = 0; i + step <= source.length; i += step + 1) text += source.substring(i, i + step);
    return text;
}
function ropes(first: string, last: string, count: number): string {
    let text = "";
    for (let i = 0; i < count; i++) {
        const two = first + last, three = first + " " + last, nested = two + three;
        text += i & 1 ? two : three;
        if (i % 5 === 4) text += nested;
        if (i % 7 === 6) text += three.slice(1, -1);
    }
    return text;
}
function onlyRope(first: string, last: string): string {
    let text = "";
    for (let i = 0; i < 1; i++) text += first + last;
    return text;
}
function throwsInTheMiddle(values: { toString(): string }[]): string {
    let text = "";
    try {
        for (const value of values) text += "<" + value + ">";
    } catch (error) {
        text += "caught " + (error as Error).message;
    }
    return text;
}
function throwsAndLeaves(values: { toString(): string }[]): string {
    try {
        let text = "";
        for (const value of values) { text += "<"; text += String(value); text += ">"; }
        return text;
    } catch (error) {
        return "left: " + (error as Error).message;
    }
}
async function acrossAwait(values: string[]): Promise<string> {
    let text = "";
    for (const value of values) { text += await Promise.resolve(value); text += "."; }
    return text;
}
function* acrossYield(values: string[]): Generator<number, string> {
    let text = "";
    for (const value of values) { text += value; yield text.length; }
    return text;
}
function twoAtOnce(values: number[]): string {
    let even = "", odd = "";
    for (const value of values) { if (value & 1) odd += value + " "; else even += value + " "; }
    return even + "/" + odd;
}
function recursive(depth: number): string {
    let text = "";
    for (let i = 0; i < 3; i++) { text += depth; if (depth) text += "(" + recursive(depth - 1) + ")"; }
    return text;
}

console.log(joinNumbers([]), joinNumbers([0]), joinNumbers([1, 22, 333, 4444, 55555, 666666, 7777777, 88888888, 99999999, 100000000, 2147483647]));
console.log(joinNumbers([-1, -0, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 4294967296, -2147483648, 123456789.125]));
console.log(checksum(joinNumbers(Array.from({ length: 400 }, (_, i) => i * 7919))));
for (const count of [0, 1, 2, 15, 16, 17, 31, 32, 33, 127, 128, 129, 143, 144, 145, 4095, 4096, 4097]) console.log(count, checksum(repeat("x", count)), checksum(repeat("abcdefg", count)), checksum(repeat("0123456789abcdef", count)));
console.log(checksum(repeat("y".repeat(127), 3)), checksum(repeat("y".repeat(128), 3)), checksum(repeat("y".repeat(129), 3)), checksum(repeat("z".repeat(5000), 40)));
const long = "L".repeat(70000);
console.log(checksum(repeat(long, 1)), repeat(long, 1) === long, checksum(repeat(long, 3)), checksum(joinStrings(["a", long, "b", long], "-")));
console.log(joinStrings(["a"], ","), joinStrings(["", "", ""], ","), joinStrings(["é", "日本", "x"], "→"), checksum(joinStrings(Array.from({ length: 60 }, (_, i) => (i % 9 ? "ascii" : "日本語") + i), ", ")));
console.log(joinAnything([1, "a", null, undefined, true, 2.5, -0, 10n, [1, [2, 3]], { toString() { return "object"; } }, Symbol.iterator.description]));
console.log(joinOptional(["a", undefined, null, "", "undefined"]), checksum(joinOptional(Array.from({ length: 40 }, (_, i) => (i % 3 ? undefined : i % 2 ? null : "s" + i)))));
console.log(joinBooleans([true, false]), checksum(joinBooleans(Array.from({ length: 50 }, (_, i) => i % 3 === 0))));
console.log(lengths("ab", 100), lengths("é", 100), lengths("0123456789", 40));
const source = "The quick brown fox jumps over the lazy dog. ".repeat(20), wide = source + "日本";
for (const step of [0, 1, 3, 8, 17, 40, 130, 300]) console.log(step, checksum(pieces(source, step)), checksum(pieces(wide, step)), checksum(pieces(wide.slice(-40), step)));
console.log(checksum(ropes("Ada", "Lovelace", 1)), checksum(ropes("Ada", "Lovelace", 4)), checksum(ropes("Ada", "Lovelace", 40)), checksum(ropes("first name of many letters", "last name of many more letters", 30)), checksum(ropes("é", "日本", 30)), checksum(ropes("", "x", 9)));
console.log(onlyRope("on", "ly"), checksum(onlyRope("p".repeat(100), "q".repeat(100))), checksum(onlyRope(long, long)));
const bad = { toString(): string { throw new Error("no text"); } };
console.log(throwsInTheMiddle(["a", "b"]), throwsInTheMiddle(["a", bad, "c"]), checksum(throwsInTheMiddle([repeat("w", 200), bad])));
console.log(throwsAndLeaves(["a", "b"]), throwsAndLeaves(["a", bad, "c"]), throwsAndLeaves([repeat("w", 200), bad]), checksum(throwsAndLeaves([repeat("w", 200), "z"])));
const steps = acrossYield(["a", "bc", repeat("d", 200)]);
console.log(steps.next().value, steps.next().value, steps.next().value, checksum(steps.next().value as string));
console.log(twoAtOnce([1, 2, 3, 4, 5, 6]), checksum(twoAtOnce(Array.from({ length: 200 }, (_, i) => i * 3))));
console.log(recursive(0), recursive(2), checksum(recursive(6)));
try { console.log(repeat(repeat("M", 1 << 20), 4096).length); } catch (error) { console.log((error as Error).constructor.name); }
acrossAwait(["a", "b", repeat("c", 200)]).then(text => console.log(checksum(text)));
