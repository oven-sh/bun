// Arrays that are filled with `push` in a loop, with strings, objects and numbers.
const collect: () => void = (globalThis as any).gc ?? (() => {});
const out: string[] = [];
type Box = { v: number };
function strings(n: number): string[] { const a: string[] = []; for (let i = 0; i < n; i++) a.push("s" + i); return a; }
function boxes(n: number): Box[] { const a: Box[] = []; for (let i = 0; i < n; i++) a.push({ v: i }); return a; }
function mixed(n: number): unknown[] { const a: unknown[] = []; for (let i = 0; i < n; i++) a.push(i % 3 === 0 ? i : i % 3 === 1 ? "m" + i : null); return a; }
function numbers(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i * 2); return a; }
function doubles(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i + 0.5); return a; }
function one(s: string): string[] { const a: string[] = []; a.push(s); return a; }
function maybe(s: string, really: boolean): string[] { const a: string[] = []; if (really) a.push(s); return a; }
function either(c: boolean, from: string[]): string[] { const r = c ? [] : from.slice(0, 1); r.push("x"); return r; }
function two(n: number): [string[], Box[]] { const a: string[] = [], b: Box[] = []; for (let i = 0; i < n; i++) { a.push("t" + i); b.push({ v: -i }); } return [a, b]; }
function leaf(): string[] { const a: string[] = []; a.push("leaf"); return a; }
function sum(a: readonly unknown[]): number { let s = a.length * 1000; for (const v of a) s += typeof v === "number" ? v : typeof v === "string" ? v.length : v === null ? 7 : (v as Box).v; return s; }
const sizes = [[0], [1], [3], [5], [6], [9], [12], [26], [40], [130], [1, 1, 1, 30], [30, 1, 1, 1], [0, 0, 0, 7], [2, 4, 8, 16, 32, 64]];
for (const pattern of sizes) {
    let total = 0;
    for (let round = 0; round < 700; round++) {
        const n = pattern[round % pattern.length];
        total += sum(strings(n)) + sum(boxes(n)) + sum(mixed(n)) + sum(numbers(n)) + sum(doubles(n));
        const [a, b] = two(n % 11); total += sum(a) + sum(b);
        total += sum(one("o" + round)) + sum(maybe("m", round % 5 === 0)) + sum(either(round % 2 === 0, ["f", "g"])) + sum(leaf());
    }
    out.push(pattern.join("-") + " " + total);
    collect();
}
{ const a = strings(3), b = strings(3); a.push("more"); out.push("apart " + a.join() + " | " + b.join() + " | " + (a === b)); }
console.log(out.join("\n"));
