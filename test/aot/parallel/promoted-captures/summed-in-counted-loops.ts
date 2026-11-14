// A closure reads a parameter of the function that made it once. A counted loop sums what the closure returns.
declare const process: { readonly argv: readonly string[] };
const list = [1, 2, 3, 4];
function make(salt: number) { return (a: number, b: number): number => { a = a + salt - salt; list[a & 3] = a; return list[a & 3]!; }; }
const f = make(1);
function total(a: number, b: number): number { let x = 0; for (let i = 0; i < 3; i++) x += f(a, b); return x; }
const numbers: number[] = JSON.parse(process.argv[2] ?? "null") ?? [0, 1, 2.5, 4294967295];
for (const a of numbers) for (const b of numbers) console.log(total(a, b));
