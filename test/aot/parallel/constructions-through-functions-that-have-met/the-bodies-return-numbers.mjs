function alpha() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7; }
function beta() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 9; }
function pick(flag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return flag ? alpha : beta; }
function build(flag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const maker = pick(flag); return new maker(); }
let kinds = "";
for (let i = 0; i < 300; i++) kinds = typeof build(i % 2 === 0);
console.log(kinds);
