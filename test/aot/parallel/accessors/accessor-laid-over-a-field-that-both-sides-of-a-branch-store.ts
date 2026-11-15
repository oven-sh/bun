// an accessor is laid over a field that both sides of a branch store and the code behind them reads
class Box { n: number; constructor(n: number) { this.n = n; } }
function subject(o: Box, c: unknown) { if (c) o.n = 1; else o.n = 2; return o.n; }
const log: string[] = [];
function deed(o: Box) { Object.defineProperty(o, "n", { get() { return 99; }, set(v: number) { log.push("set " + v); }, configurable: true }); }
const box = new Box(0);
console.log(String(subject(box, true)), String(subject(box, false)));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(box, i % 3);
console.log(String(sum));
deed(box);
console.log(String(subject(box, true)), String(subject(box, false)), log.join());
for (let i = 0; i < 3; i++) console.log(String(subject(i % 2 ? box : new Box(5), i)));
console.log(log.join());
