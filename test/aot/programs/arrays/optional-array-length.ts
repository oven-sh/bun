declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public kind: number, public label: number) {} }
function outer(seed: number) {
    let stack: Rec[] | undefined;
    let text: string | null = null;
    let either: Rec[] | string | undefined;
    function fill(n: number): void { stack = []; for (let i = 0; i < n; i++) stack.push(new Rec(i % 4, i + seed)); text = "x".repeat(n); either = n & 1 ? stack : text; }
    function clear(): void { stack = undefined; text = null; either = undefined; }
    function down(): number { if (stack) { for (let i = stack.length - 1; i >= 0; i--) { const b = stack[i]; if (b.kind === 3) return b.label; } } return -1; }
    function downAndCleared(): number { let t = 0; if (stack) { for (let i = stack.length - 1; i >= 0; i--) { t += stack[i].label; if (i === 2) clear(); } } return t; }
    function last(): number { return stack ? stack[stack.length - 1].label : -1; }
    function half(): number { return stack ? stack.length / 2 : -1; }
    function minusOne(): number { return stack!.length - 1; }
    function ofText(): number { let n = 0; if (text !== null) for (let i = text.length - 1; i >= 0; i -= 2) n++; return n; }
    function ofEither(): number { return either ? either.length - 1 : -2; }
    function unguarded(): number { return (stack as Rec[]).length - 1; }
    return { fill, clear, down, downAndCleared, last, half, minusOne, ofText, ofEither, unguarded };
}
function tell(f: () => unknown): string { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "threw"; } }
const o = outer(10);
for (const n of [0, 1, 2, 5, 8]) {
    o.fill(n);
    console.log(n, [o.down, o.last, o.half, o.minusOne, o.ofText, o.ofEither, o.unguarded, o.downAndCleared, o.down, o.minusOne, o.unguarded, o.ofText, o.ofEither].map(tell).join(" "));
}
