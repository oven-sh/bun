// A getter above a prototype that super reads through runs on the caller's object, also where the prototype stores the field that the getter reads.
const top = { get size() { return this.field; } };
const prototype = { __proto__: top, field: "the prototype's" };
const reader = { __proto__: prototype, read() { return super.size; } };
let right = 0;
for (let i = 0; i < 300; i++) right += reader.read.call({ field: i }) === i;
console.log(right, reader.read.call(prototype), reader.read.call(5), reader.read());
const late = { field: "the prototype's" };
const lateReader = { __proto__: late, read() { return super.size; } };
console.log(lateReader.read.call({ field: 1 }));
Object.setPrototypeOf(late, top);
right = 0;
for (let i = 0; i < 300; i++) right += lateReader.read.call(i % 3 ? { field: i } : { other: 1, field: i }) === i;
console.log(right);
