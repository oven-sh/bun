// The entry point of a typed function for callers that do not know its types tests the arguments and jumps to the function; it holds no second copy of the body.
// IR= 1 yieldsObject CallDirect
// IR= 1 yieldsNumber CallDirect
// IR= 1 yieldsNothing CallDirect
// IR= 3 awaits AwaitBySavingFrame
declare const console: any;
interface P { a: number; next: P | undefined }
let count = 0;
function yieldsObject(p: P, k: number): P | undefined { return k & 1 ? p : p.next; }
function yieldsNumber(p: P, k: number): number { return p.a + k; }
function yieldsNothing(p: P, k: number): void { count += p.a + k; }
async function callee(x: number): Promise<number> { return x + 1; }
async function awaits(x: number): Promise<number> { return (await callee(x)) + (await callee(x + 1)) + (await callee(x + 2)); }
const table: any[] = [yieldsObject, yieldsNumber, yieldsNothing];
const p: P = { a: 1, next: { a: 2, next: undefined } };
let s = 0;
for (let i = 0; i < 2_000_000; i++) { const o = table[0](p, i); s += o.a + table[1](p, i); table[2](p, i); }
awaits(1).then(v => console.log(s, count, v));
export {};
