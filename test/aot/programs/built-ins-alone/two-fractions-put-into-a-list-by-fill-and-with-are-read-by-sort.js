const held = new Array(2).fill(1.5).with(1, 2.5);
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
