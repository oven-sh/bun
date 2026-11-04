// a matrix
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const rows: number[][] = []; for (let y = 0; y < 3; y++) { const row: number[] = []; for (let x = 0; x < 3; x++) row.push(x * y + 0.5 * (x & 1)); rows.push(row); }
let sum = 0; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) sum += rows[y][x];
(rows as any)[1][1] = "hole in the proof"; out.push(String(sum));
for (let y = 0; y < hidden<number>("3"); y++) { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(rows[y][i])); out.push(got.join()); }
console.log(out.join(" | "));
