declare const console: { log(...values: unknown[]): void };
class Token {
    kind: number; start: number; end: number; flags: number;
    constructor(kind: number, start: number, end: number, flags: number) { this.kind = kind; this.start = start; this.end = end; this.flags = flags; }
}
class Pair { left: number = 0; right: number = 0; }
const names = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
const seen = new Map<number, number>();
const sink: unknown[] = [];
function show(v: unknown): string { return typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
function keep(v: unknown): unknown { sink.length = 0; sink.push(v); return sink[0]; }

function asNumberAndAsWord(t: Token): string {
    const k = t.kind;
    const half = k + 0.5, twice = k * 2, square = k * k, wide = k + 2147483647, low = k - 2147483648;
    return [k, half, twice, square, wide, low, k < 0, k <= -1, k === -1, k !== 0, k > 2147483646, k >>> 0, k >> 1, k >>> 1, k << 1, k & 255, k | 1, k ^ -1, ~k, -k, Math.abs(k), k % 7, k / 2].join();
}
function copiedAndBoxed(t: Token, p: Pair): string {
    const s = t.start;
    p.left = s; p.right = s + 1;
    const boxed = keep(s);
    seen.set(s, (seen.get(s) ?? 0) + 1);
    return show(boxed) + " " + p.left + " " + p.right + " " + (boxed === s) + " " + Object.is(boxed, s) + " " + seen.get(s) + " " + `${s}` + " " + JSON.stringify({ s }) + " " + String(s).length;
}
function indexAndNumber(t: Token, list: string[]): string {
    const f = t.flags;
    const name = list[f & 7], direct = list[f], text = "abcdefgh".charAt(f), code = "abcdefgh".charCodeAt(f);
    return name + " " + direct + " [" + text + "] " + code + " " + (f + 1) + " " + (f in list) + " " + list.slice(f).length + " " + (f < list.length);
}
function switched(t: Token): string {
    const k = t.kind;
    let s: string;
    switch (k) {
        case -2147483648: s = "least"; break;
        case -1: s = "minus one"; break;
        case 0: s = "nothing"; break;
        case 1: s = "one"; break;
        case 2147483647: s = "most"; break;
        default: s = k < 0 ? "below" : "above";
    }
    return s + ":" + k;
}
function spans(tokens: Token[]): string {
    let total = 0, longest = -2147483648, negatives = 0, bits = 0, last = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i], start = t.start, end = t.end;
        const length = end - start;
        total += length;
        if (length > longest) longest = length;
        if (start < 0) negatives++;
        bits ^= start;
        last = end;
    }
    return total + " " + longest + " " + negatives + " " + bits + " " + last;
}
function overWords(words: Int32Array, copy: Int32Array, wide: Float64Array): string {
    let total = 0, negatives = 0, bits = 0, last = 0;
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        total += w; if (w < 0) negatives++; bits ^= w; copy[i] = w; wide[i] = w; last = w;
    }
    let back = 0;
    for (let i = words.length - 1; i >= 0; i--) { const w = words[i]; back = back * 3 + w; if (w === -1) back += 0.25; copy[i] = copy[i] + (w >> 31); }
    let pairs = 0;
    for (let i = 0; i + 1 < words.length; i += 2) { const a = words[i], b = words[i + 1]; pairs += a * 2 + b; if (a > b) pairs -= a; }
    return total + " " + negatives + " " + bits + " " + last + " " + back + " " + pairs + " " + copy.join() + " " + wide.join();
}
function throughUntyped(t: Token, f: (v: any) => any): string {
    const e = t.end;
    const answer = f(e);
    return show(answer) + " " + (e + answer) + " " + (e === answer) + " " + (e | 0) + " " + (e > answer - 1);
}

const given = [0, 1, -1, 2, -2, 7, -7, 255, -256, 65535, -65536, 1073741824, -1073741824, 2147483646, 2147483647, -2147483647, -2147483648];
for (let turn = 0; turn < 3; turn++) {
    const tokens = given.map((k, i) => new Token(k, given[(i + 3) % given.length], given[(i + 5) % given.length], given[(i + 7) % given.length]));
    const pair = new Pair();
    for (const t of tokens)
        console.log(asNumberAndAsWord(t) + " | " + copiedAndBoxed(t, pair) + " | " + indexAndNumber(t, names) + " | " + switched(t) + " | " + throughUntyped(t, v => v) + " | " + throughUntyped(t, v => -v));
    console.log(spans(tokens));
    const words = Int32Array.from(given);
    console.log(overWords(words, new Int32Array(words.length), new Float64Array(words.length)));
    console.log(overWords(new Int32Array(0), new Int32Array(0), new Float64Array(0)) + "|" + overWords(Int32Array.of(-5), new Int32Array(1), new Float64Array(1)));
}
