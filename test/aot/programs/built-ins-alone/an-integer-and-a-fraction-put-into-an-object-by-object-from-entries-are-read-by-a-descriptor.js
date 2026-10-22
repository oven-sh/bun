const held = Object.fromEntries([["a", 7], ["b", 1.5]]);
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value + 1);
