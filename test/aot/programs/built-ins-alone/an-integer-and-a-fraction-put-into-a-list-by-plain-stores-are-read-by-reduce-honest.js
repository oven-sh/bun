const held = [];
held[0] = 7;
held[1] = 1.5;
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
