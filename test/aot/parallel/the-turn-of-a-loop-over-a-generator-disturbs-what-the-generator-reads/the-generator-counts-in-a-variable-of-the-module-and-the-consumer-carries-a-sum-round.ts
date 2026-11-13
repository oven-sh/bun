// The loop of a generator is walked with the turn of its consumer inside it: the generator counts in a variable of the module and the consumer carries a sum round.
let seen: number = JSON.parse("0");
function* upTo(n: number): Generator<number> { for (let i = 0; i < n; i++) { seen++; yield i; } }
function sum(n: number): number { let s = 0; for (const x of upTo(n)) s += x; return s; }
const n: number = JSON.parse("5");
let r = 0;
for (let t = 0; t < 10; t++) r += sum(n);
console.log(r, seen);
export {};
