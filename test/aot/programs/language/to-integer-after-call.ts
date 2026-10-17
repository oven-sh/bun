// A quotient, and Math.trunc of a product, made ahead of a test and converted to an integer behind it and behind a call of another function: the function is split there.
declare const console: { log(...values: unknown[]): void };
const noted: string[] = [];
function note(text: string, depth: number): void { if (depth > 0) note(text + ".", depth - 1); else noted.push(text); }
function quotientBehindCall(k: number, d: number): number { const q = (k + 9) / d; if (k > 1) { note("quotient", 2); return q | 0; } return -1; }
function floorBehindCall(k: number, d: number): number { const q = (k + 9) / d; if (k > 1) { note("floor", 2); return Math.floor(q); } return -1; }
function truncBehindCall(k: number): number { const t = Math.trunc(k * 2.75); if (k > 1) { note("trunc", 2); return t & 255; } return -1; }
function first(): number { let t = 0; for (let k = 1; k < 6; k++) t += quotientBehindCall(k, k) + floorBehindCall(k, 3) + truncBehindCall(k); return t; }
function second(): number { let t = 0; for (let k = 3; k < 9; k++) t += quotientBehindCall(k, 2) * 2 + floorBehindCall(k, k) + truncBehindCall(k + 1); return t; }
console.log(first(), second(), quotientBehindCall(7, 2), floorBehindCall(9, 4), truncBehindCall(5), noted.length);
