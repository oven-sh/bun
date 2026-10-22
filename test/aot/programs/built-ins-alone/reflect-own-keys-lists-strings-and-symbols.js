const keys = Reflect.ownKeys({ first: 1, [Symbol.iterator]: 2, 0: 3 });
console.log(keys.length, keys[0], keys[1].length, typeof keys[2], keys[2] === Symbol.iterator);
