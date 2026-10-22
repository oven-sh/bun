const held = [];
held.push("text");
held.push("more text");
console.log(held.find(() => true).length, held.findLast(() => true).length);
