// A member of an object literal under a well-known symbol: the generator method of a literal break return and throw run the finally.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
const told: string[] = [];
function make(k: number): any { return { *[Symbol.iterator]() { try { for (let i = 0; i < k; i++) yield i + 1; } finally { told.push("closed"); } } }; }
function first(l: any): number { for (const x of l) if (x === 2) return x; return -1; }
function fails(l: any): string { try { for (const x of l) if (x === 3) throw new Error("three"); return "none"; } catch (e) { return (e as Error).message; } }
function stops(l: any): number { let s = 0; for (const x of l) { if (x === 4) break; s += x; } return s; }
console.log(first(make(5)), fails(make(5)), stops(make(9)), first(make(1)), told.join());
