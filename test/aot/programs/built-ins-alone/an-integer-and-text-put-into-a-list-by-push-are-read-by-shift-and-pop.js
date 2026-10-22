const held = [];
held.push(7);
held.push("text");
console.log(held.shift() + 1, held.pop().length);
console.log(held.length, held.pop() === undefined);
