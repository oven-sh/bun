const held = [0].flatMap(() => [1.5, 2.5]);
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
