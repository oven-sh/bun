function run(n: number): number { let i = n | 0; let t = 0; for (; i > 0; i -= 2) t += i; return i * 100000 + t; }
let said = ""; for (let n = -3; n < 80; n++) said += run(n) + " "; console.log(said);
