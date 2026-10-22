const held = [];
held.push("text");
held.push("more text");
console.log(held.reduceRight((kept, value) => value).length, held.reduce((kept, value) => value).length);
