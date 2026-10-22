const held = Object.assign([], { 0: 1.5, 1: 2.5 });
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
