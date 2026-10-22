const held = [];
held.unshift(1.5);
held.unshift(7);
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
