const held = [];
held.push(7);
held.push("text");
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value).length);
