// A for-in loop walks `Bun` and Object.assign copies `process`. The keys of the copy are listed.
// Alone: the order of the keys follows from which members were read first, and the other programs of a joined executable read some
let count = 0;
for (const key in Bun) count++;
console.log(count > 0);
console.log(Reflect.ownKeys(Object.assign({}, process)).map(String).join(" "));
