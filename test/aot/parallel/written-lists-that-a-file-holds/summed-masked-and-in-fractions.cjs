// STATISTIC: ConstantArrayGuardsHoisted >= 3
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52]; const FRACTIONS = [0.5, 1.25, 2, 3.75];
function sum(t) { let s = t & 1; for (let i = 0; i < TABLE.length; i++) s += TABLE[i]; return s; }
function masked(t) { let s = 0; for (let i = 0; i < 20; i++) s += TABLE[(i * 7 + t) & 7]; return s; }
function fractions(t) { let s = t & 1; for (let i = 0; i < FRACTIONS.length; i++) s += FRACTIONS[i]; return s; }
let all = 0; for (let t = 0; t < 50; t++) all += sum(t) + masked(t) + fractions(t);
console.log(all);
