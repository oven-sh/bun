function run(n: number): number { let h = 7; for (let i = 5; i < (n | 0); i--) { h = (h * 31 + i) | 0; if (i < -40) break; } return h; }
let said = ""; for (let n = -3; n < 12; n++) said += run(n) + " "; console.log(said);
