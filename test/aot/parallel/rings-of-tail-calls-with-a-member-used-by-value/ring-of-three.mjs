let work = 0;
function a(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return b(n - 1); }
function b(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 2; return c(n - 1); }
function c(n) { for (let i = 0; i < 2; i++) work = (work + 2) | 0; if (n === 0) return 3; return a(n - 1); }
console.log([3].map(c).join());
let answer; try { answer = a(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
