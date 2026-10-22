// Fields are filled from the result of a function, from two variables that other code changes, and from a closure.
const log = [];
let shared = 1; var top = 2;
function pick(i) { return i === 0 ? 1 : i === 1 ? 2147483648 : i === 2 ? 0.5 : -1; }
function Holder(i) { this.fromResult = pick(i); this.fromVariable = shared; this.fromTop = top; this.fromClosure = (() => shared + top)(); }
const holders = [];
for (let i = 0; i < 4; i++) { holders.push(new Holder(i)); shared *= 65536; top -= 0.25; }
for (const h of holders) log.push(h.fromResult + 1, h.fromVariable | 0, h.fromVariable + 1, h.fromTop * 4, h.fromClosure);
console.log(log.join("; "));
