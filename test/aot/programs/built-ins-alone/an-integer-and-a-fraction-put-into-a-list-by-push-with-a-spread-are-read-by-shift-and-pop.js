const held = [];
held.push(...[7, 1.5]);
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
