// A member of an object literal under a well-known symbol: a value that is no method under the symbol.
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const walk = function* () { yield 1; yield 2; };
console.log(sum({ [Symbol.iterator]: walk }), sum({ [Symbol.iterator]: 5 }), sum({ [Symbol.iterator]: undefined }), sum({ [Symbol.iterator]: () => 5 }), sum({ [Symbol.iterator]: () => ({}) }));
