const peek = Reflect.get(Bun, "peek");
console.log(peek(Promise.resolve(1)));
