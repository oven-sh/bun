// list of lists
type Nest = Nest[];
type T = { grid: number[][] };
let out = "";
const shared = [1, 2];
function make(n: number): T { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return { grid: [[n], [n, 2], []] }; }
function send(status: number, value: T): void { out += JSON.stringify(value) + status + "\n"; }
function shape() { for (let i = 0; i < 5; i++) send(200 + i, make(i)); }
shape(); shape();
console.log(out);
