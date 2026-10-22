const held = new Array(2).fill(7).with(1, 1.5);
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
