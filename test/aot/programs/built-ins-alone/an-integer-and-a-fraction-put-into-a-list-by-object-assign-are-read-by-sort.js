const held = Object.assign([], { 0: 7, 1: 1.5 });
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
