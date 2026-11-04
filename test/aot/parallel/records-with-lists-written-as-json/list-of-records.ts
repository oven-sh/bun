// list of records
type Nest = Nest[];
type T = { ok: boolean; lines: { sku: string; n: number }[] };
let out = "";
const shared = [1, 2];
function make(n: number): T { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return { ok: n > 1, lines: [{ sku: "a" + n, n }, { sku: "b", n: 2 }] }; }
function send(status: number, value: T): void { out += JSON.stringify(value) + status + "\n"; }
function shape() { for (let i = 0; i < 5; i++) send(200 + i, make(i)); }
shape(); shape();
console.log(out);
