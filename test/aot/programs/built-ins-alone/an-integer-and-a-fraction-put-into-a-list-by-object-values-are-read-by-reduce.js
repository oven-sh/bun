const held = Object.values({ a: 7, b: 1.5 });
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
