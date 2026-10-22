const held = Object.create(null, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value + 1);
