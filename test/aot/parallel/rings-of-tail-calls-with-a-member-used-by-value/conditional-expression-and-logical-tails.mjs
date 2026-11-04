let work = 0;
function even(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return n === 0 ? 1 : odd(n - 1); }
function odd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; return n === 0 ? 0 : (work, even(n - 1)); }
console.log([3].map(odd).join());
let answer; try { answer = even(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
