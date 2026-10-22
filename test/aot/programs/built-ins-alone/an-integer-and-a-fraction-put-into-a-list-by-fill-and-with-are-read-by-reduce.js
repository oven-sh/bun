const held = new Array(2).fill(7).with(1, 1.5);
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
