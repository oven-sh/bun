const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
