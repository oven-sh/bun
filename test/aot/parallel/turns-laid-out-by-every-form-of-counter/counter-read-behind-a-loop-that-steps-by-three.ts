function run(n: number): number { let i = 0; let t = 0; for (; i < (n | 0); i += 3) t += 1; return i * 1000 + t; }
let said = ""; for (let n = -3; n < 80; n++) said += run(n) + " "; console.log(said);
