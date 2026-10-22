const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.append("an", 2.5);
console.log(typeof result, result === undefined, subject instanceof URLSearchParams, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length);
console.log(Array.isArray(items[3]), items[3].length);
