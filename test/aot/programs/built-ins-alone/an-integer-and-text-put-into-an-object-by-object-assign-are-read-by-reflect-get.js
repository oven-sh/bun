const held = Object.assign({}, { a: 7 }, { b: "text" });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b").length);
