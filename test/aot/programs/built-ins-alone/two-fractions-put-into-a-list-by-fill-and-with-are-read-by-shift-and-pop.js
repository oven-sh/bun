const held = new Array(2).fill(1.5).with(1, 2.5);
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
