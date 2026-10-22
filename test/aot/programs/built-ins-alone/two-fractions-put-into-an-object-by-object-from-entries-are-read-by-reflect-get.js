const held = Object.fromEntries([["a", 1.5], ["b", 2.5]]);
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
