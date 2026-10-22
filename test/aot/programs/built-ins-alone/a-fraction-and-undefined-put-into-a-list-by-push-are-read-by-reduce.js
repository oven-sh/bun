const held = [];
held.push(1.5);
held.push(undefined);
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) === undefined);
