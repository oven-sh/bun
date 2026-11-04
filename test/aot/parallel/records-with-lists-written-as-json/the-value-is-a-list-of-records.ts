// the value is a list of records
type Nest = Nest[];
type T = { id: number; tags: string[] }[];
let out = "";
const shared = [1, 2];
function make(n: number): T { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return [{ id: n, tags: ["t" + n] }, { id: 0, tags: [] }]; }
function send(status: number, value: T): void { out += JSON.stringify(value) + status + "\n"; }
function shape() { for (let i = 0; i < 5; i++) send(200 + i, make(i)); }
shape(); shape();
console.log(out);
