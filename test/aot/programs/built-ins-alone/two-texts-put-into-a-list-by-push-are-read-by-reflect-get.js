const held = [];
held.push("text");
held.push("more text");
console.log(Reflect.get(held, 0).length, Reflect.get(held, "1").length);
