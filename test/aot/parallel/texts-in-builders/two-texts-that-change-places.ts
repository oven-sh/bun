// two texts grow in one loop and change places: in every turn, in some turns, and once behind the loop
function always(n: number) { let a = "a"; let b = "b"; for (let i = 0; i < n; i++) { a += i; b += "-" + i; const t = a; a = b; b = t; } return a + "|" + b; }
function sometimes(n: number) { let a = "a"; let b = "b"; for (let i = 0; i < n; i++) { a += i; b += "-" + i; if (i % 3 === 1) { const t = a; a = b; b = t; } } return a + "|" + b; }
function behind(n: number) { let a = "a"; let b = "b"; for (let i = 0; i < n; i++) { a += i; b += "-" + i; } const t = a; a = b; b = t; return a + "|" + b; }
function oneTakesTheOther(n: number) { let a = "a"; let b = "b"; for (let i = 0; i < n; i++) { a += i; b = a; b += "!"; } return a + "|" + b; }
console.log(always(0), always(1), always(2), always(5));
console.log(sometimes(0), sometimes(2), sometimes(5), sometimes(8));
console.log(behind(0), behind(1), behind(4));
console.log(oneTakesTheOther(0), oneTakesTheOther(1), oneTakesTheOther(4));
