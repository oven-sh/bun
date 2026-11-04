// A for-in loop walks `Bun` and Object.assign copies `process`. The keys of the copy are listed.
let count = 0;
for (const key in Bun) count++;
console.log(count > 0);
console.log(Reflect.ownKeys(Object.assign({}, process)).map(String).join(" "));
