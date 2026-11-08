// `text.charCodeAt(index)` is an int32 or NaN, and what reads it here takes any value: the int32 is boxed as the int32 that it is, on its own way to the place where the two meet.
function show(value: unknown): string {
    return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
}

const kept: unknown[] = [];
function keep(value: unknown) { kept.push(value); return value; }

function codeAt(text: string, index: number) { return text.charCodeAt(index); }
function codeOrLess(text: string, index: number): unknown { return index >= 0 ? text.charCodeAt(index) : index; }
function isSlash(text: string, index: number) { return text.charCodeAt(index) === 47; }
function pointAt(text: string, index: number) { return text.codePointAt(index); }

function makeScanner(text: string) {
    let pos: number = 0;
    let last: unknown;
    return {
        next() { last = text.charCodeAt(pos); pos++; return last; },
        peek(ahead: number) { return text.charCodeAt(pos + ahead); },
        back() { pos--; return text.charCodeAt(pos); },
        where() { return pos; },
        last() { return last; },
    };
}

const narrow = "a/bÿ\u0000";
const wide = "a/Ā￿😀";
const part = String(Date.now() > 0 ? "left/" : "");
const rope = part + narrow + wide + part;
const texts = [narrow, wide, rope, "", "/", rope.slice(3, 9)];
const indexes: number[] = [0, 1, 2, 3, 4, 5, 6, 20, 21, 22, -1, -0, 0.5, 1.9, -0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, 4294967296, 4294967297];

for (const text of texts) {
    for (const index of indexes)
        console.log(JSON.stringify(text), show(index), show(keep(codeAt(text, index))), show(codeOrLess(text, index)), isSlash(text, index), show(pointAt(text, index)));
    const scanner = makeScanner(text);
    const seen: string[] = [];
    for (let turn = 0; turn < text.length + 2; ++turn)
        seen.push(show(scanner.next()) + "@" + show(scanner.where()) + "~" + show(scanner.peek(1)));
    seen.push(show(scanner.back()), show(scanner.back()), show(scanner.last()));
    console.log(seen.join(" "));
}
console.log(kept.length, kept.filter(value => typeof value !== "number").length, kept.filter(value => value !== value).length, kept.reduce((sum: number, value) => value === value ? sum + (value as number) : sum, 0));
try {
    console.log(show(codeAt(12345 as unknown as string, 1)));
} catch (error) {
    console.log((error as Error).name);
}
