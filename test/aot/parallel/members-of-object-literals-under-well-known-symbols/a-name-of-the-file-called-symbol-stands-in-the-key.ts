// A member of an object literal under a well-known symbol: a name of the file called symbol stands in the key.
const Symbol = { iterator: "walk" };
const o: any = { [Symbol.iterator]() { return 5; } };
console.log(Object.keys(o).join(), o.walk(), Object.getOwnPropertySymbols(o).length);
try { for (const x of o) console.log(x); } catch (e) { console.log((e as Error).constructor.name); }
export {};
