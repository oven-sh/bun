function even(n) { if (n === 0) return 1; return odd(n - 1); }
function odd(n) { if (n === 0) return 0; return even(n - 1); }
console.log([3].map(odd).join());
let answer; try { answer = even(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
