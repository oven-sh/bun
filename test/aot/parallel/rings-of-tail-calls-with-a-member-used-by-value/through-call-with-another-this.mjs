let work = 0;
const holder = { bias: 0 };
function even(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1 + this.bias; return odd.call(holder, n - 1); }
function odd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return this.bias; return even.call(holder, n - 1); }
console.log([3].map(odd, holder).join());
let answer; try { answer = even.call(holder, 4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
