const held = [0].flatMap(() => [7, 1.5]);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
