const sym = Symbol();
const obj1 = { [sym]: 1 };
const obj4 = {};
Object.defineProperty(obj4, sym, { value: 1 }); // non-enumerable

console.log(Bun.deepEquals(obj1, obj4)); // should be 'false'
