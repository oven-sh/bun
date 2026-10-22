const held = [];
held.push(1.5);
held.push(undefined);
console.log(held.find(() => true) + 1, held.findLast(() => true) === undefined);
