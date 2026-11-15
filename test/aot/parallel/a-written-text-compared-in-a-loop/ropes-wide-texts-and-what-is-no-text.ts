declare const process: { argv: string[] };
const n = 3;
const kinds: string[] = Array.from({ length: 64 }, (_, i) => [("al" + String(process.argv.length > 99 ? 1 : "pha")), "\u03b1lpha", 5 as any, null as any, "alpha", undefined as any, { toString() { return "alpha"; } } as any, "alph"][i & 7]!);
function count(kinds: string[]): number { let hits = 0; for (const kind of kinds) if (kind === "alpha") hits++; return hits; }
let sum = 0; for (let t = 0; t < n; t++) sum = (sum + count(kinds)) % 1000003; console.log(sum);
export {};
