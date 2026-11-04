let work = 0;
function hub(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return n % 2 ? left(n - 1) : right(n - 1); }
function left(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 2; return hub(n - 1); }
function right(n) { for (let i = 0; i < 2; i++) work = (work + 2) | 0; if (n === 0) return 3; return hub(n - 1); }
console.log([3].map(right).join());
let answer; try { answer = hub(4000000) + left(4000001); } catch (error) { answer = error.constructor.name; }
console.log(answer);
