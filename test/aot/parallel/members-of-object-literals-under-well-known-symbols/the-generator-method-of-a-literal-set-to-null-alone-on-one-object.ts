// A member of an object literal under a well-known symbol: the generator method of a literal set to null alone on one object.
function make(k: number): any { return { *[Symbol.iterator]() { for (let i = 0; i < k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
function listed(l: any): string { try { return [...l].join(); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const k: number = JSON.parse("2"); const a = make(k), b = make(k); b[Symbol.iterator] = null;
console.log([sum(a), sum(b), sum(a), listed(a), listed(b)].join(" | "));
export {};
