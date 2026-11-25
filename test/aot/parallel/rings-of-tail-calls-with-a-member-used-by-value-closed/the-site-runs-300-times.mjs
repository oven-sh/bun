let work = 0, total = 0;
function even(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return odd(n - 1); }
function odd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 0; return even(n - 1); }
for (let i = 0; i < 300; i++) total += [i].map(odd)[0] + even(i);
console.log(total);
let answer; try { answer = even(4000000); } catch (error) { answer = error.name; }
console.log(answer);
