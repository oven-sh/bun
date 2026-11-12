let work = 0;
function isEven(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return true; return isOdd(n - 1); }
function isOdd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return false; return isEven(n - 1); }
console.log([3, 4].filter(isOdd).join());
let answer; try { answer = isEven(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
