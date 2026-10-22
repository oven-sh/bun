const held = new Array(2).fill(7).with(1, 1.5);
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
