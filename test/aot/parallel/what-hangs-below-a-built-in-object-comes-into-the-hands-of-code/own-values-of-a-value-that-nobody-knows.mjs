function all(of) { return Object.values(of); }
all({ a: 1 });
const found = all(Object.getOwnPropertyDescriptors(Array.prototype)).map(d => d.value).find(v => typeof v === "function" && v.name === "flatMap");
console.log(found.call([1, 2], x => [x, x]).join());
