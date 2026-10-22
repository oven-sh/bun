const held = Object.values({ a: 1.5, b: 2.5 });
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
