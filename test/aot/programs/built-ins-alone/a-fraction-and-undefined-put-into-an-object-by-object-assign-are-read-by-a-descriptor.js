const held = Object.assign({}, { a: 1.5 }, { b: undefined });
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value === undefined);
