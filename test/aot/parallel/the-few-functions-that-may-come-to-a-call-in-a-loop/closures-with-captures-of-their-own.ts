// Three closures of two functions, each with a capture of its own.
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
function adder(n: number) { return (x: number) => x + n; } function scaler(n: number) { return (x: number) => x * n; }
const add3 = adder(3), add9 = adder(9), by2 = scaler(2);
let sum = 0;
for (let i = 0; i < 999; i++) { const r = i % 3; const f = r === 0 ? add3 : r === 1 ? by2 : add9; sum += f(i & 15); }
console.log(sum);
