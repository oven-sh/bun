const n = 3;
const kinds: string[] = Array.from({ length: 64 }, (_, i) => ["alphb", "betas", "gamma", "delta"][i & 3]!);
function count(kinds: string[]): number { let hits = 0; for (const kind of kinds) if (kind === "alpha") hits++; return hits; }
let sum = 0; for (let t = 0; t < n; t++) sum = (sum + count(kinds)) % 1000003; console.log(sum);
export {};
