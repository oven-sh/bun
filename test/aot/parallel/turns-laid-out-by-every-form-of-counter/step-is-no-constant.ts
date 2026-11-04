function run(n: number, step: number): number { let h = 7; for (let i = 0; i < (n | 0); i += step | 0) { h = (h * 31 + i) | 0; if (h === 1) break; } return h; }
let said = ""; for (let n = -3; n < 40; n++) said += run(n, 1) + "," + run(n, 3) + " "; console.log(said);
