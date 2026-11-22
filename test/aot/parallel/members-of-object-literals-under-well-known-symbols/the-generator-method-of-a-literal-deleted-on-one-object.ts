// A member of an object literal under a well-known symbol: the generator method of a literal deleted on one object.
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(3), b = make(3); delete b[Symbol.iterator]; for (let run = 0; run < 4; run++) console.log(sum(run & 1 ? b : a));
