// A member of an object literal under a well-known symbol: the generator method of a literal the field that the generator reads is changed in the turn.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(6); let s = 0; for (const x of a) { s += x; if (x === 2) a.k = 3; } console.log(s, sum(a));
