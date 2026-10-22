const held = Object.assign({}, { a: 7 }, { b: "text" });
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value.length);
