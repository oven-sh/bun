// The first alternative fails behind more than a hundred million steps back over runs of single characters, which no limit of plain Bun counts; the second matches at once.
const nothing = String(Date.now()).slice(99);
const match = new RegExp("a*a*a*a*a*a*c|a+" + nothing).exec("a".repeat(102));
console.log(match === null ? "null" : match[0].length);
