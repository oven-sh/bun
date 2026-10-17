// A step that is one of a few constants, chosen by a test, added to a number that is no integer by its type.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function sizeOf(ch: number): number { if (ch >= 0x10000) return 2; if (ch === -1) return 0; return 1; }
function makeWalker(start: number) {
    let pos = start;
    function step(ch: number): number { pos += sizeOf(ch); return pos; }
    function back(ch: number): number { pos -= ch > 9 ? 3 : ch < 0 ? -2 : 0; return pos; }
    function scale(ch: number): number { pos *= ch > 9 ? 2 : ch < 0 ? -1 : 0; return pos; }
    function divide(ch: number): number { pos /= ch > 9 ? 4 : ch < 0 ? -2 : 0; return pos; }
    function both(ch: number): string { const by = ch > 9 ? 5 : 7; pos += by; return pos + ":" + (by & 3) + ":" + [10, 20, 30, 40, 50, 60, 70, 80][by]; }
    function big(ch: number): number { pos += ch > 9 ? 9007199254740992 : ch < 0 ? -4294967296 : 2147483648; return pos; }
    function set(to: number): void { pos = to; }
    return { step, back, scale, divide, both, big, set };
}
function walk(text: string): number { let at = 0.5, n = 0; while (at < text.length) { const ch = text.charCodeAt(at); at += ch === 32 ? 2 : ch > 109 ? 3 : 1; n++; } return at * 100 + n; }
const starts: number[] = JSON.parse("[0, 1, -1, 0.5, -0.5, -0, 2147483647, -2147483648, 4294967295, 9007199254740991, 1e21, 5e-324]");
for (const name of JSON.parse('["NaN","Infinity","-Infinity"]') as string[]) starts.push(Number(name));
for (const start of starts) {
    const w = makeWalker(start), out: string[] = [];
    for (const ch of [65, 0x10000, -1, 10, 0]) { w.set(start); out.push([w.step(ch), w.back(ch), w.scale(ch), w.divide(ch)].map(show).join(",") + "," + w.both(ch) + "," + show(w.big(ch))); }
    console.log(show(start), out.join(" | "));
}
console.log(walk("the quick brown fox jumps over the lazy dog"), walk(""), walk("zzzz"));
