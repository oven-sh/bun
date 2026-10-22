const held = Object.assign({}, { a: "text" }, { b: "more text" });
console.log(Object.getOwnPropertyDescriptor(held, "a").value.length, Object.getOwnPropertyDescriptor(held, "b").value.length);
