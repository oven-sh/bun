// A member of an object literal under a well-known symbol: the generator method of a literal spread and pattern and arguments.
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(4); const [p, q, ...rest] = a; console.log([...a].join(), p, q, rest.join(), Math.max(...a), Array.from(a).length, new Set(a).size);
