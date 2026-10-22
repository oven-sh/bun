const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
