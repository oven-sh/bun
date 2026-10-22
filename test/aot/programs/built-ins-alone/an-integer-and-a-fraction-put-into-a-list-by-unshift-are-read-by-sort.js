const held = [];
held.unshift(1.5);
held.unshift(7);
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
