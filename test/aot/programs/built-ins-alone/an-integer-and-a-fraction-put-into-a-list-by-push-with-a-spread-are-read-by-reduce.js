const held = [];
held.push(...[7, 1.5]);
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
