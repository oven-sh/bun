// A call that became direct through inlining can itself be inlined without counting towards the depth limit.
declare const console: any;
let seen = 0;
function inner(a: number, b: number): number { seen += a; return a * 3 + b * 5 + (a > b ? 1 : 2); }
function button(p: number): number { seen += 1; return inner(p, p + 1) + inner(p + 2, p) + 7; }
function other(p: number): number { seen += 2; return inner(p, 1) - 11; }
function render(e: { type: (p: number) => number, props: number }): number { seen += 3; return e.type(e.props) + e.props * 2; }
export function viaLiteral(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += render({ type: button, props: i }); return sum; }
export function viaLiteralOfTwo(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += render({ type: i & 1 ? button : other, props: i }); return sum; }
function fourth(a: number, b: number): number { seen += a; return a * 3 + b * 5 + (a > b ? 1 : 2); }
function third(p: number): number { seen += 1; return fourth(p, p + 1) + fourth(p + 2, p) + 7; }
function second(p: number): number { seen += 3; return third(p) + p * 2; }
function first(p: number): number { seen += 4; return second(p) + p * 9 + (p > 3 ? 1 : 0); }
export function byName(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += first(i); return sum; }
function thrower(p: number): number { if (p === 3) throw new RangeError("three"); return inner(p, 2); }
export function throughACopy(n: number): string { let sum = 0; try { for (let i = 0; i < n; i++) sum += render({ type: thrower, props: i }); } catch (error) { const e = error as Error; return sum + " " + e.message + " " + ["thrower", "render", "throughACopy"].map(name => new RegExp("\\b" + name + "\\b").test(e.stack ?? "")).join(); } return String(sum); }
function again(p: number): number { return p > 0 ? render({ type: again, props: p - 1 }) + 1 : inner(p, p); }
console.log(viaLiteral(10), viaLiteralOfTwo(10), byName(10), throughACopy(10), again(5), seen);
