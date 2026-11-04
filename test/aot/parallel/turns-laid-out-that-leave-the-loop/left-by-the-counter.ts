function run(n: number, at: number): number { let t = 0; for (let i = 0; i < (n | 0); i++) { if (i === at) break; t += i; } return t; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void {  console.log(length, at, run(length, at)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
