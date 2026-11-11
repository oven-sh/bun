// A member of an object literal under a well-known symbol: own keys come in the order written.
const o: any = { b: 1, [Symbol.toPrimitive]() { return 5; }, a: 2, [Symbol.iterator]() { return [7][Symbol.iterator](); }, 1: 3, [Symbol.toStringTag]: "Mine" };
console.log(Reflect.ownKeys(o).map(String).join(), Object.getOwnPropertySymbols(o).map(String).join(), Object.keys(o).join(), JSON.stringify(o), String(o), +o, [...o].join(), Object.prototype.toString.call(o));
const p: any = { [Symbol.iterator]() { return [8][Symbol.iterator](); }, [Symbol.toPrimitive]() { return 6; } };
console.log(Reflect.ownKeys(p).map(String).join(), +p, [...p].join());
