// Two functions call themselves and one another through a choice between the two.
// STATISTIC: CallsToldApartByCallee >= 1
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
function down(n: number): number { const next = n & 1 ? down : half; return n <= 0 ? 0 : 1 + next(n - 1); }
function half(n: number): number { const next = n % 3 ? down : half; return n <= 0 ? 0 : 1 + next(n >> 1); }
let sum = 0;
for (let i = 0; i < 300; i++) { const f = i & 1 ? down : half; sum += f(i); }
console.log(sum);
