// A member of an object literal under a well-known symbol: the generator method of a literal a generator is made by hand too.
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(3); const byHand = a[Symbol.iterator](); console.log(byHand.next().value, sum(a), byHand.next().value, Object.getPrototypeOf(byHand) === Object.getPrototypeOf(a[Symbol.iterator]()));
