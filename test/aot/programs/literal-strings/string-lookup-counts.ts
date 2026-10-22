// A string that enters a union of string literals and that the stub has not seen is looked up by the runtime, and the look-up is counted like every other operation. The program reads the counters.
declare const aotOperationCount: (name: string) => number;
type Kind = "circle" | "square" | "ring";
class Shape { constructor(public kind: Kind) {} }
const lookUps = (): number => aotOperationCount("operationAOTToLiteralString");
const parts = ["cir", "cle", "squ", "are", "ri", "ng", "ov", "al"];
const shape = new Shape("circle");
function storeFresh(i: number): void { shape.kind = (parts[i % 4 * 2] + parts[i % 4 * 2 + 1]) as Kind; }
function storeLiteral(i: number): void { shape.kind = i % 2 ? "square" : "ring"; }
const run: ((i: number) => void)[] = [storeFresh, storeLiteral];
let before = lookUps();
let rings = 0;
for (let i = 0; i < 400; i++) { run[0](i); if (shape.kind === "ring") rings++; }
const fresh = lookUps() - before;
console.log(rings, fresh >= 400 ? "every fresh string was looked up" : "LOOKED UP " + fresh + " OF 400");
before = lookUps();
for (let i = 0; i < 400; i++) run[1](i);
console.log(shape.kind, lookUps() === before ? "no literal was looked up" : "LITERALS LOOKED UP: " + (lookUps() - before));
