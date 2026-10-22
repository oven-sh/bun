const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
