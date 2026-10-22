const held = [];
held.push(1.5);
held.push(undefined);
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") === undefined);
