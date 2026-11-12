// A member of an object literal under a well-known symbol: the generator method of a literal the object may be missing.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const list: any[] = [make(2)]; function at(i: number): string { return sum(list[i]); } console.log(at(0), at(1)); list.pop(); console.log(at(0));
