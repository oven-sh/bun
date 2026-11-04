let work = 0;
function down(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return down(n - 1); }
console.log([3].map(down).join());
let answer; try { answer = down(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
