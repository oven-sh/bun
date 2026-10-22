const held = [];
held.unshift(1.5);
held.unshift(7);
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
