const held = Object.assign({}, { a: "text" }, { b: "more text" });
console.log(Reflect.get(held, "a").length, Reflect.get(held, "b").length);
