const held = [];
held.push(1.5);
held.push(undefined);
console.log(held.shift() + 1, held.pop() === undefined);
console.log(held.length, held.pop() === undefined);
