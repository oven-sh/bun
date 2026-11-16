// A member of an object literal under a well-known symbol: the method of one of two literals is set to undefined alone.
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; try { let s = w - 1; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const k: number = JSON.parse("2"); const a = make(k), b = make(k); b[Symbol.iterator] = undefined;
console.log("SAID " + [sum(a), sum(b), sum(a)].join(" | "));
export {};
