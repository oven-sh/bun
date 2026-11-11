const n = 3;
const kinds: string[] = Object.keys({ alpha: 1, be: 2, gamma1: 3, delta: 4, alphb: 5, e: 6, zeta: 7, eta: 8 });
function count(kinds: string[]): number { let hits = 0; for (const kind of kinds) if (kind === "alpha") hits++; return hits; }
let sum = 0; for (let t = 0; t < n; t++) sum = (sum + count(kinds)) % 1000003; console.log(sum);
export {};
