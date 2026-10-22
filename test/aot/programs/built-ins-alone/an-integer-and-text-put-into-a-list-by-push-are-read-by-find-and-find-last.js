const held = [];
held.push(7);
held.push("text");
console.log(held.find(() => true) + 1, held.findLast(() => true).length);
