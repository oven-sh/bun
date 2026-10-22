const held = [];
held.push("text");
held.push("more text");
console.log(held.shift().length, held.pop().length);
console.log(held.length, held.pop() === undefined);
