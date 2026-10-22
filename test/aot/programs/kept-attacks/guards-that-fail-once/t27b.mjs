// Guards that fail once, one probe of many. It prints what plain Bun prints.
class List extends Array {}
const rounds = Number(process.argv[2]);
const which = process.argv[3];
const value = { array: [1, 2], text: "text", list: List.of(1) }[which];
const ask = { name: v => v.name, prototype: v => v.prototype, length: v => v.length }[process.argv[4]];
let n = 0;
for (let round = 0; round < rounds; round++) n += ask(value) === undefined ? 1 : 0;
console.log(n);
