// The call and the construction of one of two are what their functions return.
// STATISTIC: JoinsDuplicatedPerCallee >= 1
function plusOne(x: number) { return x + 1; } function timesTen(x: number) { return x * 10; }
function pick(i: number) { const f = i & 1 ? plusOne : timesTen; return f(i & 7); }
function build(i: number) { const Tree = i & 1 ? Ash : Birch; return new Tree(); }
class Ash { k = 1; } class Birch { k = 2; }
let sum = 0;
for (let i = 0; i < 1000; i++) { sum += pick(i) + build(i).k; }
console.log(sum);
